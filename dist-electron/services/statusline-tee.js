"use strict";
// statusLine wrapper: captures stdin (which contains rate_limits / context_window / model)
// to ~/.claude/claudegauge-live.json, then forwards stdin to the original
// statusLine command (read from ~/.claudegauge/statusline-original.json) so
// the user's existing statusline (e.g. claude-hud) still works.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const livePath = path.join(os.homedir(), ".claude", "claudegauge-live.json");
const originalPath = path.join(os.homedir(), ".claudegauge", "statusline-original.json");
let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", () => {
    try {
        if (data.trim())
            fs.writeFileSync(livePath, data, "utf8");
    }
    catch { }
    // Forward to original command if configured
    let cfg = null;
    try {
        cfg = JSON.parse(fs.readFileSync(originalPath, "utf8"));
    }
    catch { }
    if (!cfg || !cfg.command) {
        // No forwarder configured — emit empty statusline
        process.stdout.write("");
        return;
    }
    const child = spawn(cfg.command, cfg.args || [], {
        shell: true,
        stdio: ["pipe", "inherit", "inherit"],
    });
    child.stdin.write(data);
    child.stdin.end();
    child.on("exit", (code) => process.exit(code || 0));
    child.on("error", () => process.exit(0));
});
