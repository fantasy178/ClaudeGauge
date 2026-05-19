"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const out = path.join(os.homedir(), ".claude", "claudegauge-live.json");
let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
    try {
        if (data.trim())
            fs.writeFileSync(out, data, "utf8");
    }
    catch (e) {
        // best-effort
    }
});
