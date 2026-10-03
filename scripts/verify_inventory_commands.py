"""Exercise inventory Command RPCs against an isolated PostgreSQL instance."""

from __future__ import annotations

import json
import socket
import subprocess
import tempfile
from pathlib import Path

from verify_core_schema import find_bin, run


ROOT = Path(__file__).resolve().parents[1]
LAB_A = "00000000-0000-0000-0000-000000000001"
LAB_B = "00000000-0000-0000-0000-000000000002"
GLOBAL = "00000000-0000-0000-0000-000000000003"
STOCK_A = "00000000-0000-0000-0000-000000000201"
STOCK_B = "00000000-0000-0000-0000-000000000202"


def main() -> None:
    initdb, pg_ctl, psql = (find_bin(name) for name in ("initdb", "pg_ctl", "psql"))
    with tempfile.TemporaryDirectory(prefix="chemstock-commands-") as temporary:
        work = Path(temporary)
        data = work / "data"
        socket_dir = work / "socket"
        socket_dir.mkdir()
        run([initdb, "-D", str(data), "-A", "trust", "-U", "postgres"])
        with socket.socket() as available_port:
            available_port.bind(("127.0.0.1", 0))
            port = str(available_port.getsockname()[1])
        try:
            run([pg_ctl, "-D", str(data), "-o", f"-F -p {port} -k {socket_dir}",
                 "-l", str(work / "postgres.log"), "start"])
            base = [psql, "-X", "-h", str(socket_dir), "-p", port, "-U", "postgres",
                    "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"]

            def sql(statement: str) -> str:
                return run(base + ["-c", statement]).splitlines()[-1]

            def expect_error(statement: str, expected: str) -> None:
                result = subprocess.run(base + ["-c", statement], capture_output=True,
                                        text=True, check=False)
                assert result.returncode != 0, f"unexpected success: {statement}"
                assert expected in result.stderr, result.stderr

            sql("""
                create role anon;
                create role authenticated;
                create role service_role;
                create schema auth;
                create table auth.users (id uuid primary key);
                create function auth.uid() returns uuid language sql stable
                  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
                grant usage on schema auth to authenticated;
                grant execute on function auth.uid() to authenticated;
            """)
            for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
                run(base + ["-f", str(migration)])

            sql(f"""
                insert into auth.users (id) values ('{LAB_A}'), ('{LAB_B}'), ('{GLOBAL}');
                insert into public.rooms (id, name) values
                  ('00000000-0000-0000-0000-000000000101', 'Lab A'),
                  ('00000000-0000-0000-0000-000000000102', 'Lab B');
                insert into public.accounts (id, room_id, login_id, role) values
                  ('{LAB_A}', '00000000-0000-0000-0000-000000000101', 'lab-a', 'lab'),
                  ('{LAB_B}', '00000000-0000-0000-0000-000000000102', 'admin-b', 'solvent_room_admin');
                insert into public.accounts (id, login_id, role)
                  values ('{GLOBAL}', 'global', 'global_admin');
                insert into public.solvents (id, name, designated_quantity)
                  values ('00000000-0000-0000-0000-000000000301', 'Test solvent', 100);
                insert into public.inventory
                  (id, room_id, solvent_id, amount, opening_amount, opened_at)
                  values
                  ('{STOCK_A}', '00000000-0000-0000-0000-000000000101',
                   '00000000-0000-0000-0000-000000000301', 10, 10, now() - interval '2 days'),
                  ('{STOCK_B}', '00000000-0000-0000-0000-000000000102',
                   '00000000-0000-0000-0000-000000000301', 0, 0, now() - interval '2 days');
            """)

            def command(actor: str, operation: str, target: str, payload: dict,
                        key_suffix: int) -> dict:
                key = f"00000000-0000-0000-0000-{key_suffix:012d}"
                body = json.dumps(payload, ensure_ascii=False).replace("'", "''")
                result = sql(
                    f"set role authenticated; set request.jwt.claim.sub = '{actor}'; "
                    f"select public.inventory_command('{operation}', '{target}', "
                    f"'{body}'::jsonb, '{key}');"
                )
                return json.loads(result)

            movement = command(LAB_A, "movement", STOCK_A,
                               {"changeAmount": 5, "operatorName": "Student A"}, 401)
            log_id = movement["log"]["id"]
            assert float(movement["inventory"]["amount"]) == 15
            assert command(LAB_A, "movement", STOCK_A,
                           {"changeAmount": 5, "operatorName": "Student A"}, 401) == movement
            assert sql("select count(*) from public.inventory_logs") == "1"
            assert sql("select count(*) from public.command_requests") == "1"

            expect_error(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                f"select public.inventory_command('movement', '{STOCK_B}', "
                "'{\"changeAmount\":1,\"operatorName\":\"Student A\"}'::jsonb, "
                "'00000000-0000-0000-0000-000000000402');",
                "TARGET_NOT_FOUND",
            )
            expect_error(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                f"select public.inventory_command('movement', '{STOCK_A}', "
                "'{\"changeAmount\":6,\"operatorName\":\"Student A\"}'::jsonb, "
                "'00000000-0000-0000-0000-000000000401');",
                "IDEMPOTENCY_KEY_REUSED",
            )
            expect_error(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                f"select public.inventory_command('movement', '{STOCK_A}', "
                "'{\"changeAmount\":-16,\"operatorName\":\"Student A\"}'::jsonb, "
                "'00000000-0000-0000-0000-000000000403');",
                "INSUFFICIENT_STOCK",
            )
            assert sql("select count(*) from public.command_requests") == "1"

            occurred_at = movement["log"]["occurred_at"]
            correction = command(LAB_A, "correct", log_id, {
                "changeAmount": 3, "operatorName": "Student A",
                "occurredAt": occurred_at, "changedByName": "Editor", "reason": "Transcription error"
            }, 404)
            assert float(correction["inventory"]["amount"]) == 13
            assert sql("select operator_name || '|' || reason from public.operation_audits") == \
                "Editor|Transcription error"
            cancellation = command(LAB_A, "cancel", log_id,
                                   {"operatorName": "Canceller", "reason": "Wrong entry"}, 405)
            assert float(cancellation["inventory"]["amount"]) == 10
            assert cancellation["log"]["status"] == "cancelled"
            assert sql("select count(*) from public.operation_audits") == "2"
            assert command(LAB_A, "cancel", log_id,
                           {"operatorName": "Canceller", "reason": "Wrong entry"}, 405) == cancellation
            assert sql("select count(*) from public.operation_audits") == "2"

            updated_at = cancellation["inventory"]["last_updated"]
            threshold = command(LAB_A, "threshold", STOCK_A, {
                "threshold": 2, "operatorName": "Supervisor", "reason": "Safety stock",
                "expectedLastUpdated": updated_at
            }, 406)
            assert float(threshold["inventory"]["low_stock_threshold"]) == 2
            assert sql("select count(*) from public.operation_audits") == "3"
            assert command(LAB_A, "threshold", STOCK_A, {
                "threshold": 2, "operatorName": "Supervisor", "reason": "Safety stock",
                "expectedLastUpdated": updated_at
            }, 406) == threshold
            expect_error(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                f"select public.inventory_command('threshold', '{STOCK_A}', "
                f"'{{\"threshold\":3,\"operatorName\":\"Supervisor\",\"reason\":\"Old view\",\"expectedLastUpdated\":\"{updated_at}\"}}'::jsonb, "
                "'00000000-0000-0000-0000-000000000409');",
                "VERSION_CONFLICT",
            )
            expect_error(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                f"select public.inventory_command('cancel', '{log_id}', "
                "'{\"operatorName\":\"Canceller\",\"reason\":\"Again\"}'::jsonb, "
                "'00000000-0000-0000-0000-000000000410');",
                "INVALID_LOG_STATE",
            )

            deactivated = command(LAB_B, "deactivate", STOCK_B,
                                  {"operatorName": "Manager", "reason": "Unused"}, 407)
            assert deactivated["inventory"]["is_active"] is False
            assert sql("select count(*) from public.operation_audits") == "4"
            assert sql("select count(*) from public.notifications") == "0"

            exceeded = command(LAB_A, "movement", STOCK_A,
                               {"changeAmount": 95, "operatorName": "Student A"}, 408)
            assert float(exceeded["inventory"]["amount"]) == 105
            assert sql("select count(*) from public.notifications") == "1"
            assert sql("select value from public.settings where key = 'dq_arm_over'") == "false"
            assert command(LAB_A, "movement", STOCK_A,
                           {"changeAmount": 95, "operatorName": "Student A"}, 408) == exceeded
            assert sql("select count(*) from public.notifications") == "1"
            overview = json.loads(sql(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_B}'; "
                "select public.admin_overview();"
            ))
            assert overview["state"] == "exceeded"
            assert float(overview["totalRatio"]) == 1.05
            assert overview["unreadNotificationCount"] == 1
            assert len(overview["notifications"]) == 1
            assert len(overview["breakdown"]) == 1
            notice_id = overview["notifications"][0]["id"]
            expect_error(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                "select public.admin_overview();",
                "UNAUTHORIZED",
            )
            expect_error(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                f"select public.notification_command('{notice_id}', "
                "'{\"status\":\"acknowledged\",\"operatorName\":\"Student A\"}'::jsonb, "
                "'00000000-0000-0000-0000-000000000411');",
                "UNAUTHORIZED",
            )
            acknowledge_sql = (
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_B}'; "
                f"select public.notification_command('{notice_id}', "
                "'{\"status\":\"acknowledged\",\"operatorName\":\"Manager\"}'::jsonb, "
                "'00000000-0000-0000-0000-000000000412');"
            )
            acknowledged = json.loads(sql(acknowledge_sql))
            assert acknowledged["notification"]["status"] == "acknowledged"
            assert json.loads(sql(acknowledge_sql)) == acknowledged
            resolved = json.loads(sql(
                f"set role authenticated; set request.jwt.claim.sub = '{GLOBAL}'; "
                f"select public.notification_command('{notice_id}', "
                "'{\"status\":\"resolved\",\"operatorName\":\"Supervisor\",\"reason\":\"Checked stock\"}'::jsonb, "
                "'00000000-0000-0000-0000-000000000413');"
            ))
            assert resolved["notification"]["status"] == "resolved"
            assert sql("select count(*) from public.operation_audits") == "6"
            expect_error(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_B}'; "
                f"select public.notification_command('{notice_id}', "
                "'{\"status\":\"resolved\",\"operatorName\":\"Manager\",\"reason\":\"Again\"}'::jsonb, "
                "'00000000-0000-0000-0000-000000000414');",
                "INVALID_NOTIFICATION_STATE",
            )
            command(LAB_A, "movement", STOCK_A,
                    {"changeAmount": 1, "operatorName": "Student A"}, 415)
            assert sql("select count(*) from public.notifications") == "1"
            command(LAB_A, "movement", STOCK_A,
                    {"changeAmount": -11, "operatorName": "Student A"}, 416)
            assert sql("select value from public.settings where key = 'dq_arm_over'") == "true"
            command(LAB_A, "movement", STOCK_A,
                    {"changeAmount": 5, "operatorName": "Student A"}, 417)
            assert sql("select count(*) from public.notifications") == "2"

            # Email delivery remains dormant until a confirmed shared mailbox
            # and an enable time are recorded. Older notices are never mailed.
            assert json.loads(sql("set role service_role; select public.email_worker_claim(10)")) == []
            expect_error("set role authenticated; select public.email_worker_claim(10)",
                         "permission denied")
            expect_error(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                "select public.admin_email_status()", "UNAUTHORIZED")
            assert json.loads(sql(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_B}'; "
                "select public.admin_email_status()"))["enabled"] is False
            expect_error(
                "update private.email_notification_config "
                "set enabled = true, enabled_at = now(), "
                "recipient_email = 'store@example.edu', recipient_confirmed_at = now() "
                "where singleton", "email_requires_confirmed_addresses")
            sql("""
                update private.email_notification_config
                   set enabled = true, enabled_at = now(),
                       recipient_email = 'store@example.edu',
                       recipient_confirmed_at = now(),
                       sender_email = 'chemstock@example.edu',
                       sender_confirmed_at = now()
                 where singleton;
            """)
            assert json.loads(sql("set role service_role; select public.email_worker_claim(10)")) == []
            sql("update public.notifications set status = 'resolved' where status <> 'resolved'")
            command(LAB_A, "movement", STOCK_A,
                    {"changeAmount": -5, "operatorName": "Student A"}, 418)
            command(LAB_A, "movement", STOCK_A,
                    {"changeAmount": 5, "operatorName": "Student A"}, 419)
            jobs = json.loads(sql("set role service_role; select public.email_worker_claim(10)"))
            assert len(jobs) == 1
            job = jobs[0]
            assert job["recipientEmail"] == "store@example.edu"
            assert job["senderEmail"] == "chemstock@example.edu"
            assert json.loads(sql("set role service_role; select public.email_worker_claim(10)")) == []
            assert sql(
                f"set role service_role; select public.email_worker_accept('{job['id']}', "
                "'00000000-0000-0000-0000-000000000999', 'wrong-token')"
            ) == "f"
            assert sql(
                f"set role service_role; select public.email_worker_fail('{job['id']}', "
                f"'{job['leaseToken']}', 'TEMPORARY', false)"
            ) == "t"
            assert sql("select status from private.email_notification_deliveries") == "retry"
            sql("update private.email_notification_deliveries "
                "set next_attempt_at = now() - interval '1 second'")
            retried = json.loads(sql("set role service_role; select public.email_worker_claim(10)"))
            assert len(retried) == 1 and retried[0]["id"] == job["id"]
            assert sql(
                f"set role service_role; select public.email_worker_accept('{job['id']}', "
                f"'{retried[0]['leaseToken']}', null)"
            ) == "t"
            assert sql("select status from private.email_notification_deliveries") == "accepted"
            assert sql("select provider_message_id is null "
                       "from private.email_notification_deliveries") == "t"
            assert json.loads(sql("set role service_role; select public.email_worker_claim(10)")) == []
            sql("update public.notifications set status = 'resolved' where status <> 'resolved'")
            command(LAB_A, "movement", STOCK_A,
                    {"changeAmount": -5, "operatorName": "Student A"}, 420)
            command(LAB_A, "movement", STOCK_A,
                    {"changeAmount": 5, "operatorName": "Student A"}, 421)
            unknown = json.loads(sql("set role service_role; select public.email_worker_claim(10)"))
            assert len(unknown) == 1
            sql(f"update private.email_notification_deliveries "
                f"set lease_until = now() - interval '1 second' where id = '{unknown[0]['id']}'")
            assert json.loads(sql("set role service_role; select public.email_worker_claim(10)")) == []
            assert sql(f"select last_error_code from private.email_notification_deliveries "
                       f"where id = '{unknown[0]['id']}'") == "UNKNOWN_SEND_OUTCOME"
            email_status = json.loads(sql(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_B}'; "
                "select public.admin_email_status()"))
            assert email_status["acceptedCount"] == 1
            assert email_status["failedCount"] == 1
            assert email_status["recentFailures"][0]["errorCode"] == "UNKNOWN_SEND_OUTCOME"
            expect_error("set role authenticated; select * "
                         "from private.email_notification_deliveries", "permission denied")
            expect_error("set role service_role; select * "
                         "from private.email_notification_deliveries", "permission denied")

            # Release queries use persisted settings and never leak another room's stock.
            app_settings = json.loads(sql(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                "select public.app_settings()"))
            assert float(app_settings["unitGalToL"]) == 3.8
            assert app_settings["forecastWindowDays"] == 30
            forecasts = json.loads(sql(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                "select public.inventory_forecasts()"))
            assert len(forecasts) == 1 and forecasts[0]["inventoryId"] == STOCK_A
            assert forecasts[0]["status"] == "forecast"
            other_forecasts = json.loads(sql(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_B}'; "
                "select public.inventory_forecasts()"))
            assert len(other_forecasts) == 1 and other_forecasts[0]["inventoryId"] == STOCK_B
            assert other_forecasts[0]["status"] == "inactive"
            expect_error(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                "select public.admin_management()", "UNAUTHORIZED")
            assert len(json.loads(sql(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_B}'; "
                "select public.admin_management()"))["solvents"]) == 1

            room_b = "00000000-0000-0000-0000-000000000102"
            solvent = "00000000-0000-0000-0000-000000000301"
            activate = (
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_B}'; "
                f"select public.activate_room_solvent('{room_b}', '{solvent}', "
                "'Manager', 'Reopen', '00000000-0000-0000-0000-000000000501')"
            )
            assert json.loads(sql(activate))["inventory"]["is_active"] is True
            assert json.loads(sql(activate))["inventory"]["id"] == STOCK_B
            assert sql(f"select count(*) from public.operation_audits "
                       f"where target_id = '{STOCK_B}' and action = 'reactivate'") == "1"
            expect_error(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                f"select public.activate_room_solvent('{room_b}', '{solvent}', "
                "'Student', 'Try', '00000000-0000-0000-0000-000000000502')",
                "TARGET_NOT_FOUND")
            expect_error(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_B}'; "
                "select public.admin_management_command('update_setting', 'forecast_window_days', "
                "'{\"value\":\"14\",\"operatorName\":\"Manager\",\"reason\":\"Review\"}'::jsonb, "
                "'00000000-0000-0000-0000-000000000503')", "UNAUTHORIZED")

            def manage(operation: str, target: str | None, payload: dict,
                       suffix: int) -> dict:
                body = json.dumps(payload, ensure_ascii=False).replace("'", "''")
                target_sql = "null" if target is None else f"'{target}'"
                result = sql(
                    f"set role authenticated; set request.jwt.claim.sub = '{GLOBAL}'; "
                    f"select public.admin_management_command('{operation}', {target_sql}, "
                    f"'{body}'::jsonb, '00000000-0000-0000-0000-{suffix:012d}')")
                return json.loads(result)

            created = manage("create_solvent", None, {
                "name": "New solvent", "casNumber": "123-45-6",
                "designatedQuantity": "200", "operatorName": "Admin",
                "reason": "New research"
            }, 504)
            assert float(created["designated_quantity"]) == 200
            assert manage("create_solvent", None, {
                "name": "New solvent", "casNumber": "123-45-6",
                "designatedQuantity": "200", "operatorName": "Admin",
                "reason": "New research"
            }, 504) == created
            assert sql("select count(*) from public.solvents where cas_number = '123-45-6'") == "1"
            updated = manage("update_designated", created["id"], {
                "designatedQuantity": "250", "operatorName": "Admin",
                "reason": "Legal review"
            }, 505)
            assert float(updated["designated_quantity"]) == 250
            assert manage("update_setting", "forecast_window_days", {
                "value": "14", "operatorName": "Admin", "reason": "Recent use"
            }, 506)["value"] == "14"
            assert json.loads(sql(
                f"set role authenticated; set request.jwt.claim.sub = '{LAB_A}'; "
                "select public.app_settings()"))["forecastWindowDays"] == 14
            assert float(manage("update_setting", "warning_ratio", {
                "value": "0.75", "operatorName": "Admin", "reason": "Early notice"
            }, 507)["value"]) == 0.75
            assert sql("select count(*) from public.operation_audits "
                       "where action in ('create', 'update_designated', 'update_setting')") == "4"

            expect_error("set role authenticated; select * from private.designated_quantity_status",
                         "permission denied")
            expect_error("set role authenticated; select * from public.operation_audits",
                         "permission denied")
            expect_error("set role anon; select public.inventory_command('movement', "
                         f"'{STOCK_A}', '{{}}', '00000000-0000-0000-0000-000000000499')",
                         "permission denied")
            print("inventory commands: roles, replay, stock, audits, DQ and email outbox verified")
        finally:
            subprocess.run([pg_ctl, "-D", str(data), "stop", "-m", "immediate"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


if __name__ == "__main__":
    main()
