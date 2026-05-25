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
function fileMtimeMs(filePath) {
    if (!filePath || typeof filePath !== "string")
        return 0;
    try {
        return fs.statSync(filePath).mtimeMs;
    }
    catch {
        return 0;
    }
}
function shouldUpdateLive(nextText) {
    let next = null;
    let prev = null;
    try {
        next = JSON.parse(nextText);
    }
    catch {
        return true;
    }
    try {
        prev = JSON.parse(fs.readFileSync(livePath, "utf8"));
    }
    catch {
        return true;
    }
    const nextPath = next?.transcript_path;
    const prevPath = prev?.transcript_path;
    if (!nextPath || !prevPath || nextPath === prevPath)
        return true;
    const nextMtime = fileMtimeMs(nextPath);
    const prevMtime = fileMtimeMs(prevPath);
    if (!nextMtime || !prevMtime)
        return true;
    // Multiple Claude windows can refresh statusLine and race to write this file.
    // Prefer the session whose transcript is actively being written.
    return nextMtime + 5000 >= prevMtime;
}
let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", () => {
    try {
        if (data.trim() && shouldUpdateLive(data))
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
    // Strip outermost wrapping quotes around the executable path. Node spawn handles
    // spaces correctly when shell:false is used (we pass command and args separately).
    const cmd = String(cfg.command).replace(/^"|"$/g, "");
    const child = spawn(cmd, cfg.args || [], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (b) => (out += b.toString("utf8")));
    child.stderr.on("data", () => { });
    child.stdin.write(data);
    child.stdin.end();
    child.on("exit", () => {
        process.stdout.write(out);
        process.exit(0);
    });
    child.on("error", () => process.exit(0));
});
