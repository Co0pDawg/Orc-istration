// Fake board CLI for test.ps1: appends its args and ORC_BOARD_PORT to FAKE_BOARD_LOG, exits with FAKE_BOARD_EXIT (default 0).
import { appendFileSync } from "node:fs";
appendFileSync(process.env.FAKE_BOARD_LOG, `${process.argv.slice(2).join(" ")} port=${process.env.ORC_BOARD_PORT}\n`);
process.exit(Number(process.env.FAKE_BOARD_EXIT || 0));
