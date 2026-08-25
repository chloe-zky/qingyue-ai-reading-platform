import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from server import CollaborationTools, handle_request


class CollaborationToolsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary.name)
        self.tools = CollaborationTools(self.workspace)

    def tearDown(self):
        self.temporary.cleanup()

    def test_message_round_trip(self):
        sent = self.tools.send_message({
            "from_agent": "claude", "to_agent": "codex", "message": "Please review app.py"
        })
        self.assertEqual(sent["sent"]["id"], 1)
        unread = self.tools.get_status({"agent": "codex"})
        self.assertEqual(unread["unread_count"], 1)
        received = self.tools.read_messages({"agent": "codex"})
        self.assertEqual(received["messages"][0]["message"], "Please review app.py")
        self.assertEqual(self.tools.get_status({"agent": "codex"})["unread_count"], 0)

    def test_claim_conflict_and_release(self):
        first = self.tools.claim_task({"agent": "claude", "task": "UI", "paths": ["front/src"]})
        self.assertTrue(first["claimed"])
        conflict = self.tools.claim_task({
            "agent": "codex", "task": "Fix", "paths": ["front/src/App.jsx"]
        })
        self.assertFalse(conflict["claimed"])
        self.assertEqual(conflict["conflicts"][0]["agent"], "claude")
        released = self.tools.release_task({"agent": "claude", "paths": ["front/src"]})
        self.assertEqual(released["released"], ["front/src"])
        retry = self.tools.claim_task({
            "agent": "codex", "task": "Fix", "paths": ["front/src/App.jsx"]
        })
        self.assertTrue(retry["claimed"])

    def test_rejects_outside_workspace(self):
        with self.assertRaisesRegex(ValueError, "outside the workspace"):
            self.tools.claim_task({"agent": "codex", "task": "bad", "paths": ["../outside"]})

    def test_mcp_initialize_and_tool_listing(self):
        initialized = handle_request(self.tools, {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-06-18"},
        })
        self.assertEqual(initialized["result"]["serverInfo"]["name"], "collaboration")
        listed = handle_request(self.tools, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        self.assertEqual({tool["name"] for tool in listed["result"]["tools"]}, {
            "send_message", "read_messages", "claim_task", "release_task", "get_status"
        })

    def test_human_readable_views_are_generated(self):
        self.tools.send_message({"from_agent": "claude", "to_agent": "codex", "message": "hello"})
        self.tools.claim_task({"agent": "claude", "task": "UI", "paths": ["front/src/App.jsx"]})
        self.assertIn("claude → codex", (self.workspace / ".agents/messages.md").read_text())
        self.assertIn("front/src/App.jsx", (self.workspace / ".agents/tasks.md").read_text())
        json.loads((self.workspace / ".agents/state.json").read_text())

    def test_stdio_end_to_end(self):
        server_path = Path(__file__).with_name("server.py")
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
                "name": "send_message", "arguments": {
                    "from_agent": "claude", "to_agent": "codex", "message": "stdio hello"
                }
            }},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
                "name": "read_messages", "arguments": {"agent": "codex", "mark_read": True}
            }},
        ]
        completed = subprocess.run(
            [sys.executable, str(server_path), "--workspace", str(self.workspace)],
            input="".join(json.dumps(request) + "\n" for request in requests),
            text=True,
            capture_output=True,
            check=True,
        )
        responses = [json.loads(line) for line in completed.stdout.splitlines()]
        self.assertEqual([response["id"] for response in responses], [1, 2, 3])
        read_result = responses[-1]["result"]["structuredContent"]
        self.assertEqual(read_result["messages"][0]["message"], "stdio hello")


if __name__ == "__main__":
    unittest.main()
