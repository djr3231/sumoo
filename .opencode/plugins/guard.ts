type Plugin = { hooks: Record<string, any> }
import { execSync } from "child_process";

export default {
  hooks: {
    "tool.execute.before": async (input: any, output: any) => {
      if (input.call.name !== "Bash") return

      const cmd: string = input.call.input.command || ""

      // Skip if not a git commit/push
      if (!/git\s+(commit|push)/.test(cmd)) return

      // Check current branch
      try {
        const branch = execSync("git branch --show-current", {
          encoding: "utf-8",
        }).trim()

        if (branch === "main" || branch === "dev") {
          output.abort = `BLOCKED: on branch ${branch} — never commit or push to main/dev. Create a feature branch first.`
        }
      } catch {
        // Not a git repo, let it pass
      }
    },

    "tool.execute.after": async (input: any) => {
      if (
        input.call.name === "Bash" &&
        /git\s+commit/.test(input.call.input.command || "")
      ) {
        console.error(
          "Reminder: Did you test/build before committing? Rule #6 — verify before you commit."
        )
      }
    },

    "session.idle": async () => {
      console.error(
        "Reminder: Did you test/build before committing? Rule #6 — verify before you commit."
      )
    },
  },
} satisfies Plugin["hooks"]