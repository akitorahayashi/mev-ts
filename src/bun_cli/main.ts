#!/usr/bin/env bun

import { runCommandLine } from './cli/program';

if (import.meta.main) {
  runCommandLine()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
