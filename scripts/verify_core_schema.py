"""Apply the first ChemStock migration to an isolated PostgreSQL instance.

Run with: python3 scripts/verify_core_schema.py
Requires initdb, pg_ctl, and psql (optionally set PG_BIN_DIR).
"""

from __future__ import annotations

import os
import shutil
import socket as network_socket
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260929000000_core_schema.sql"


def find_bin(name: str) -> str:
    directory = os.environ.get("PG_BIN_DIR")
    candidate = Path(directory) / name if directory else None
    if candidate and candidate.is_file():
        return str(candidate)
    found = shutil.which(name)
    if found:
        return found
    mac_candidate = Path("/Library/PostgreSQL/17/bin") / name
    if mac_candidate.is_file():
        return str(mac_candidate)
    raise RuntimeError(f"{name} not found; set PG_BIN_DIR to the PostgreSQL bin directory")


def run(command: list[str]) -> str:
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode:
        raise RuntimeError(f"{' '.join(command[:2])} failed: {completed.stderr.strip()}")
    return completed.stdout.strip()


def main() -> None:
    initdb, pg_ctl, psql = (find_bin(name) for name in ("initdb", "pg_ctl", "psql"))
    with tempfile.TemporaryDirectory(prefix="chemstock-schema-") as temporary:
        work = Path(temporary)
        data = work / "data"
        socket_dir = work / "socket"
        socket_dir.mkdir()
        run([initdb, "-D", str(data), "-A", "trust", "-U", "postgres"])
        with network_socket.socket() as available_port:
            available_port.bind(("127.0.0.1", 0))
            port = str(available_port.getsockname()[1])
        try:
            run([pg_ctl, "-D", str(data), "-o", f"-F -p {port} -k {socket_dir}", "-l", str(work / "postgres.log"), "start"])
            base = [psql, "-X", "-h", str(socket_dir), "-p", port, "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"]

            def sql(statement: str) -> str:
                return run(base + ["-c", statement])

            def expect_error(statement: str, expected: str) -> None:
                result = subprocess.run(base + ["-c", statement], capture_output=True, text=True, check=False)
                if result.returncode == 0:
                    raise AssertionError(f"unexpected success: {statement}")
                if expected not in result.stderr:
                    raise AssertionError(f"expected {expected!r}, got: {result.stderr}")

            sql("""
                create role anon;
                create role authenticated;
                create schema auth;
                create table auth.users (id uuid primary key);
                create function auth.uid() returns uuid language sql stable
                  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
                grant usage on schema auth to authenticated;
                grant execute on function auth.uid() to authenticated;
            """)
            run(base + ["-f", str(MIGRATION)])
            assert sql("select count(*) from public.rooms").splitlines()[-1] == "0"
            assert sql("select value from public.settings where key='unit_gal_to_l'").splitlines()[-1] == "3.8"

            sql("""
                insert into auth.users (id) values
                  ('00000000-0000-0000-0000-000000000001'),
                  ('00000000-0000-0000-0000-000000000002'),
                  ('00000000-0000-0000-0000-000000000003');
                insert into public.rooms (name) values ('Lab A'), ('Lab B');
                insert into public.accounts (id, room_id, login_id, role)
                  select '00000000-0000-0000-0000-000000000001', id, 'lab-a', 'lab'
                  from public.rooms where name = 'Lab A';
                insert into public.accounts (id, room_id, login_id, role)
                  select '00000000-0000-0000-0000-000000000002', id, 'admin-b', 'solvent_room_admin'
                  from public.rooms where name = 'Lab B';
                insert into public.accounts (id, login_id, role)
                  values ('00000000-0000-0000-0000-000000000003', 'global', 'global_admin');
                insert into public.solvents (name, designated_quantity)
                  values ('Test solvent', 400);
                insert into public.inventory (room_id, solvent_id, amount, opening_amount)
                  select r.id, s.id, 10, 10 from public.rooms r cross join public.solvents s;
            """)

            def visible_counts(account_id: str) -> str:
                result = sql(f"""
                    set role authenticated;
                    set request.jwt.claim.sub = '{account_id}';
                    select (select count(*) from public.rooms),
                           (select count(*) from public.inventory),
                           (select count(*) from public.accounts),
                           (select count(*) from public.solvents),
                           has_column_privilege('authenticated', 'public.solvents', 'designated_quantity', 'select'),
                           has_table_privilege('authenticated', 'public.inventory', 'update');
                """)
                return result.splitlines()[-1]

            assert visible_counts("00000000-0000-0000-0000-000000000001") == "1|1|1|1|f|f"
            assert visible_counts("00000000-0000-0000-0000-000000000002") == "1|1|1|1|f|f"
            assert visible_counts("00000000-0000-0000-0000-000000000003") == "2|2|1|1|f|f"

            expect_error("set role anon; select * from public.inventory", "permission denied")
            expect_error("set role authenticated; select designated_quantity from public.solvents", "permission denied")
            expect_error("set role authenticated; insert into public.inventory (room_id, solvent_id) select room_id, solvent_id from public.inventory limit 1", "permission denied")
            expect_error("insert into public.settings (key, value) values ('forecast_window_days', '0')", "settings_valid_value")
            expect_error("insert into public.solvents (name, designated_quantity) values ('Invalid', 0)", "designated_quantity")
            expect_error("""
                insert into public.command_requests
                  (account_id, idempotency_key, operation, target_id, arguments)
                values ('00000000-0000-0000-0000-000000000001',
                  gen_random_uuid(), 'movement', 'target', '{}');
            """, "result is required at commit")
            sql("""
                begin;
                insert into public.command_requests
                  (account_id, idempotency_key, operation, target_id, arguments)
                values ('00000000-0000-0000-0000-000000000001',
                  '00000000-0000-0000-0000-000000000101', 'movement', 'target', '{}');
                update public.command_requests set result = '{}'
                  where idempotency_key = '00000000-0000-0000-0000-000000000101';
                commit;
            """)
            expect_error("update public.command_requests set arguments = '{\"amount\":1}' where idempotency_key = '00000000-0000-0000-0000-000000000101'", "immutable")
            print("core schema: migration, role scope, grants, constraints, and command result verified")
        finally:
            subprocess.run([pg_ctl, "-D", str(data), "stop", "-m", "immediate"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


if __name__ == "__main__":
    main()
