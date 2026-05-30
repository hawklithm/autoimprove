"""
JSONL parser for Claude Code session files.

Parses session files in JSONL format and extracts messages and tool calls.
"""

import json
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass


@dataclass
class Message:
    """Represents a message in the session."""
    role: str  # 'user', 'assistant', 'system'
    content: str
    timestamp: Optional[str] = None
    line_number: int = 0


@dataclass
class ToolCall:
    """Represents a tool call in the session."""
    tool_name: str
    input: Dict[str, Any]
    timestamp: Optional[str] = None
    line_number: int = 0


@dataclass
class SessionData:
    """Parsed session data."""
    session_id: str
    messages: List[Message]
    tool_calls: List[ToolCall]
    metadata: Dict[str, Any]


class JSONLParser:
    """Parses Claude Code session JSONL files."""

    def parse_file(self, file_path: Path) -> SessionData:
        """
        Parse a JSONL session file.

        Args:
            file_path: Path to JSONL file

        Returns:
            SessionData object

        Raises:
            FileNotFoundError: If file doesn't exist
            ValueError: If file is empty or invalid
        """
        if not file_path.exists():
            raise FileNotFoundError(f"Session file not found: {file_path}")

        messages = []
        tool_calls = []
        metadata = {}

        # Extract session ID from filename
        session_id = file_path.stem

        with open(file_path, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue

                try:
                    data = json.loads(line)
                    self._process_line(data, line_num, messages, tool_calls, metadata)
                except json.JSONDecodeError as e:
                    # Skip malformed lines but log warning
                    print(f"Warning: Skipping malformed JSON at line {line_num}: {e}")
                    continue
                except Exception as e:
                    print(f"Warning: Error processing line {line_num}: {e}")
                    continue

        if not messages and not tool_calls:
            raise ValueError(f"No valid data found in session file: {file_path}")

        return SessionData(
            session_id=session_id,
            messages=messages,
            tool_calls=tool_calls,
            metadata=metadata
        )

    def _process_line(
        self,
        data: Dict[str, Any],
        line_num: int,
        messages: List[Message],
        tool_calls: List[ToolCall],
        metadata: Dict[str, Any]
    ) -> None:
        """Process a single JSONL line."""

        # Extract timestamp if available
        timestamp = data.get('timestamp')

        # Check if it's a message
        if 'role' in data:
            role = data['role']
            content = data.get('content', '')

            # Handle content that might be a list or dict
            if isinstance(content, list):
                # Extract text from content blocks
                text_parts = []
                for block in content:
                    if isinstance(block, dict):
                        if block.get('type') == 'text':
                            text_parts.append(block.get('text', ''))
                        elif 'text' in block:
                            text_parts.append(block['text'])
                content = '\n'.join(text_parts)
            elif isinstance(content, dict):
                content = content.get('text', str(content))
            elif not isinstance(content, str):
                content = str(content)

            if content:  # Only add non-empty messages
                messages.append(Message(
                    role=role,
                    content=content,
                    timestamp=timestamp,
                    line_number=line_num
                ))

        # Check if it's a tool call
        elif data.get('type') == 'tool_use':
            tool_name = data.get('name', '')
            tool_input = data.get('input', {})
            if tool_name:
                tool_calls.append(ToolCall(
                    tool_name=tool_name,
                    input=tool_input,
                    timestamp=timestamp,
                    line_number=line_num
                ))

        # Extract metadata
        if 'metadata' in data:
            metadata.update(data['metadata'])

    def get_user_messages(self, session_data: SessionData) -> List[Message]:
        """
        Get only user messages from session.

        Args:
            session_data: Parsed session data

        Returns:
            List of user messages
        """
        return [m for m in session_data.messages if m.role == 'user']

    def get_assistant_messages(self, session_data: SessionData) -> List[Message]:
        """
        Get only assistant messages from session.

        Args:
            session_data: Parsed session data

        Returns:
            List of assistant messages
        """
        return [m for m in session_data.messages if m.role == 'assistant']

    def get_tool_calls_by_name(self, session_data: SessionData, tool_name: str) -> List[ToolCall]:
        """
        Get tool calls filtered by tool name.

        Args:
            session_data: Parsed session data
            tool_name: Name of tool to filter by

        Returns:
            List of matching tool calls
        """
        return [tc for tc in session_data.tool_calls if tc.tool_name == tool_name]

    def extract_file_paths(self, session_data: SessionData) -> List[str]:
        """
        Extract file paths from tool calls.

        Args:
            session_data: Parsed session data

        Returns:
            List of unique file paths
        """
        file_paths = set()

        for tool_call in session_data.tool_calls:
            # Check common parameter names for file paths
            for param in ['file_path', 'path', 'file', 'filepath']:
                if param in tool_call.input:
                    path = tool_call.input[param]
                    if isinstance(path, str):
                        file_paths.add(path)

        return sorted(file_paths)
