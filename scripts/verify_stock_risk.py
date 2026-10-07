"""Isolated PostgreSQL tests for risk calculations, authorization and auditing.

Requires PostgreSQL binaries (or PG_BIN_DIR) and Node >=22.18.
No production connection, research data or external service is used.
"""
from __future__ import annotations

import json
import socket
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from verify_core_schema import find_bin, run

ROOT = Path(__file__).resolve().parents[1]
UUID = "00000000-0000-0000-0000-"
LAB, OTHER, GLOBAL = (UUID + f"{i:012d}" for i in (1, 2, 3))
ROOM, OTHER_ROOM, STOCK, OTHER_STOCK, SOLVENT, RECEIPT = (
    UUID + f"{i:012d}" for i in (101, 102, 201, 202, 301, 401))


def literal(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def json_sql(value: object) -> str:
    return literal(json.dumps(value, ensure_ascii=False)) + "::jsonb"


def normalized(value: dict) -> dict:
    # PostgreSQL emits an offset; TypeScript emits Z. Compare the same instants.
    result = dict(value)
    for field in ("historyStartAt", "historyEndAt", "generatedAt"):
        if result[field]:
            result[field] = int(datetime.fromisoformat(result[field].replace("Z", "+00:00")).timestamp() * 1000)
    return result


def main() -> None:
    initdb, pg_ctl, psql = (find_bin(name) for name in ("initdb", "pg_ctl", "psql"))
    node = ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", str(ROOT / "scripts/verify_stock_risk.mjs")]
    with tempfile.TemporaryDirectory(prefix="chemstock-risk-") as temporary:
        work = Path(temporary)
        data, socket_dir = work / "data", work / "socket"
        socket_dir.mkdir()
        run([initdb, "-D", str(data), "-A", "trust", "-U", "postgres"])
        with socket.socket() as port_socket:
            port_socket.bind(("127.0.0.1", 0))
            port = str(port_socket.getsockname()[1])
        try:
            run([pg_ctl, "-D", str(data), "-o", f"-F -p {port} -k {socket_dir}",
                 "-l", str(work / "postgres.log"), "start"])
            base = [psql, "-X", "-h", str(socket_dir), "-p", port, "-U", "postgres",
                    "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"]

            def sql(statement: str) -> str:
                return run(base + ["-c", statement]).splitlines()[-1]

            def fail(statement: str, expected: str) -> None:
                result = subprocess.run(base + ["-c", statement], capture_output=True, text=True, check=False)
                assert result.returncode != 0, statement
                assert expected in result.stderr, result.stderr

            def auth(actor: str, statement: str) -> str:
                return f"set role authenticated; set request.jwt.claim.sub={literal(actor)}; {statement}"

            sql("""
                create role anon; create role authenticated; create role service_role;
                create schema auth; create table auth.users(id uuid primary key);
                create function auth.uid() returns uuid language sql stable as
                $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
                grant usage on schema auth to authenticated;
                grant execute on function auth.uid() to authenticated;
            """)
            for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
                run(base + ["-f", str(migration)])
            # Deterministic engine parity for the full public result, not just a rate.
            cases = json.loads(run(node + ["--fixtures"]))
            ts = subprocess.run(node + ["--calculate"], input=json.dumps(cases), capture_output=True, text=True, check=True)
            results = json.loads(ts.stdout)
            for case, expected in zip(cases, results, strict=True):
                actual = json.loads(sql(
                    "select private.calculate_stock_risk("
                    f"jsonb_populate_record(null::public.inventory, {json_sql(case['stock'])}),"
                    f"{json_sql(case['logs'])},"
                    f"{'null' if case['review'] is None else json_sql(case['review'])},"
                    f"{literal(case['asOf'])}::timestamptz)"))
                assert normalized(actual) == normalized(expected), (case["name"], actual, expected)

            clock = sql("select to_char(statement_timestamp() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
            sample = json.loads(run(node + ["--fixtures", clock]))[0]
            s = sample["stock"]
            sql(f"""
                insert into auth.users values ('{LAB}'), ('{OTHER}'), ('{GLOBAL}');
                insert into public.rooms(id,name) values ('{ROOM}','Lab A'), ('{OTHER_ROOM}','Lab B');
                insert into public.accounts(id,room_id,login_id,role) values
                ('{LAB}','{ROOM}','risk-lab','lab'), ('{OTHER}','{OTHER_ROOM}','risk-admin','solvent_room_admin');
                insert into public.accounts(id,login_id,role) values ('{GLOBAL}','risk-global','global_admin');
                insert into public.solvents(id,name,designated_quantity) values ('{SOLVENT}','Synthetic solvent',100);
                insert into public.inventory(id,room_id,solvent_id,amount,opening_amount,opened_at,low_stock_threshold) values
                ('{STOCK}','{ROOM}','{SOLVENT}',6,61,{literal(s['opened_at'])},4),
                ('{OTHER_STOCK}','{OTHER_ROOM}','{SOLVENT}',6,6,{literal(s['opened_at'])},4);
                insert into public.command_requests(id,account_id,idempotency_key,operation,target_id,arguments,result)
                values ('{RECEIPT}','{LAB}','{RECEIPT}','synthetic_seed','{STOCK}','{{}}','{{}}');
                insert into public.inventory_logs(id,inventory_id,command_request_id,created_by_account_id,
                  change_amount,operator_name,status,occurred_at,created_at,updated_at)
                select id,inventory_id,'{RECEIPT}'::uuid,'{LAB}'::uuid,change_amount,'Synthetic',status,occurred_at,created_at,updated_at
                from jsonb_to_recordset({json_sql(sample['logs'])})
                as x(id uuid,inventory_id uuid,change_amount numeric,status text,occurred_at timestamptz,created_at timestamptz,updated_at timestamptz);
            """)
            assert json.loads(sql(auth(LAB, "select public.fn_stock_risk()"))) == []
            settings = json.loads(sql(auth(LAB, "select public.app_settings()")))
            assert settings["stockRiskAvailable"] is True and settings["stockRiskEnabled"] is False
            fail(auth(LAB, f"select public.fn_stock_risk('{OTHER_ROOM}',null)"), "TARGET_NOT_FOUND")
            fail(auth(LAB, f"select public.fn_stock_risk(null,'{OTHER_STOCK}')"), "TARGET_NOT_FOUND")
            fail("set role anon; select public.fn_stock_risk()", "permission denied")
            fail(auth(LAB, "select private.calculate_stock_risk(null,'[]',null,now())"), "permission denied")
            fail(auth(LAB, "update public.settings set value='true' where key='stock_risk_enabled'"), "permission denied")

            def cmd_statement(actor: str, op: str, target: str | None, payload: dict, suffix: int) -> str:
                target_sql = literal(target) if target else "null"
                return auth(actor, f"select public.stock_risk_command({literal(op)}, {target_sql},"
                                  f"{json_sql(payload)}, '{UUID}{suffix:012d}')")

            def command(op: str, target: str | None, payload: dict, suffix: int) -> dict:
                return json.loads(sql(cmd_statement(GLOBAL, op, target, payload, suffix)))

            enable = {"enabled": True, "operatorName": "Synthetic admin", "reason": "Isolated trial"}
            for actor in (LAB, OTHER):
                fail(cmd_statement(actor, "enable", None, enable, 500), "UNAUTHORIZED")
            fail(cmd_statement(GLOBAL, "enable", None, {**enable, "operatorName": " "}, 500), "INVALID_COMMAND")
            # Global admins can inspect review metadata while display is disabled.
            metadata = json.loads(sql(auth(GLOBAL, "select public.stock_risk_reviews()")))
            assert len(metadata) == 2 and all(item["auditId"] is None for item in metadata)
            for actor in (LAB, OTHER):
                fail(auth(actor, "select public.stock_risk_reviews()"), "UNAUTHORIZED")
            fail("set role anon; select public.stock_risk_reviews()", "permission denied")
            enabled = command("enable", None, enable, 501)
            assert command("enable", None, enable, 501) == enabled
            fail(cmd_statement(GLOBAL, "enable", None, {**enable, "enabled": False}, 501), "IDEMPOTENCY_KEY_REUSED")
            assert sql("select count(*) from public.operation_audits where action='stock_risk_enable'") == "1"
            assert json.loads(sql(auth(LAB, "select public.app_settings()")))["stockRiskEnabled"] is True

            def read(actor: str = LAB) -> list:
                return json.loads(sql(auth(actor, "select public.fn_stock_risk()")))

            assert len(read()) == 1 and read()[0]["inventoryId"] == STOCK
            assert len(read(OTHER)) == 1 and read(OTHER)[0]["inventoryId"] == OTHER_STOCK
            assert len(read(GLOBAL)) == 2
            assert read()[0]["reasonCodes"] == ["history_quality_unverified"]
            revision = sql(f"select last_updated from public.inventory where id='{STOCK}'")
            quality = {"eligible": True, "verifiedFrom": s["opened_at"], "expectedLastUpdated": revision,
                       "operatorName": "Synthetic admin", "reason": "Confirmed complete synthetic history", "expectedReviewAuditId": None}
            fail(cmd_statement(LAB, "quality", STOCK, quality, 502), "UNAUTHORIZED")
            fail(cmd_statement(GLOBAL, "quality", STOCK, {**quality, "expectedLastUpdated": s["opened_at"]}, 502), "VERSION_CONFLICT")
            verified = command("quality", STOCK, quality, 503)
            assert command("quality", STOCK, quality, 503) == verified
            assert sql("select count(*) from public.operation_audits where action='stock_risk_quality'") == "1"
            fail(cmd_statement(GLOBAL, "quality", STOCK, {key: value for key, value in quality.items() if key != "expectedReviewAuditId"}, 520), "INVALID_COMMAND")
            fail(cmd_statement(GLOBAL, "quality", STOCK, quality, 521), "VERSION_CONFLICT")
            meta = next(item for item in json.loads(sql(auth(GLOBAL, "select public.stock_risk_reviews()"))) if item["inventoryId"] == STOCK)
            assert meta["auditId"] == verified["auditId"] and meta["eligible"] is True
            risk = read()[0]
            assert risk["status"] == "ready" and risk["reachedWindowCount"] == 149, risk
            assert risk["windowOutbound"] == {"median": 2.5, "p95": 2.5, "max": 2.5}
            assert sql(f"select last_updated from public.inventory where id='{STOCK}'") == revision
            assert sql("select count(*) from public.notifications") == "0"
            assert sql("select count(*) from private.email_notification_deliveries") == "0"
            # A real cancel command changes the historical evidence and suppresses the rate.
            log_version = sql(f"select updated_at from public.inventory_logs where id='{sample['logs'][0]['id']}'")
            cancel_payload = {"operatorName": "Synthetic student", "reason": "Wrong record", "expectedLogUpdated": log_version}
            sql(auth(LAB, f"select public.inventory_command('cancel','{sample['logs'][0]['id']}',"
                          f"{json_sql(cancel_payload)}, '{UUID}000000000504')"))
            changed = read()[0]
            assert changed["status"] == "data_quality_issue"
            assert changed["reasonCodes"] == ["history_changed_since_review"]
            assert changed["historicalReachRate"] is None
            revision = sql(f"select last_updated from public.inventory where id='{STOCK}'")
            quality["expectedLastUpdated"] = revision
            quality["expectedReviewAuditId"] = verified["auditId"]
            confirmed = command("quality", STOCK, quality, 505)
            assert read()[0]["status"] == "ready"
            quality["expectedReviewAuditId"] = confirmed["auditId"]
            revoked = command("quality", STOCK, {**quality, "eligible": False}, 506)
            # Quality writes do not change stock.last_updated; the independent token rejects stale approval.
            fail(cmd_statement(GLOBAL, "quality", STOCK, quality, 522), "VERSION_CONFLICT")
            assert command("quality", STOCK, {**quality, "eligible": False}, 506) == revoked
            assert next(item for item in json.loads(sql(auth(GLOBAL, "select public.stock_risk_reviews()"))) if item["inventoryId"] == STOCK)["auditId"] == revoked["auditId"]
            assert read()[0]["reasonCodes"] == ["history_quality_unverified"]
            command("enable", None, {**enable, "enabled": False}, 507)
            assert read() == []
            disabled_meta = next(item for item in json.loads(sql(auth(GLOBAL, "select public.stock_risk_reviews()"))) if item["inventoryId"] == STOCK)
            assert disabled_meta["auditId"] == revoked["auditId"] and disabled_meta["eligible"] is False
            print(f"stock risk SQL: {len(cases)} TypeScript parity cases; scope, enable/review, replay, audit and cancellation verified")
        finally:
            subprocess.run([pg_ctl, "-D", str(data), "stop", "-m", "immediate"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


if __name__ == "__main__":
    main()
