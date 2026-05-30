"""
Atomic file operations for AutoImprove.

Provides safe file write operations to prevent data corruption.
"""

import os
import json
from pathlib import Path
from typing import Any, Dict, Callable
import tempfile
import shutil


def atomic_write_text(path: Path, content: str, encoding: str = 'utf-8') -> None:
    """
    Write text to file atomically.

    Uses write-to-temp-then-rename pattern to ensure atomicity.

    Args:
        path: Target file path
        content: Text content to write
        encoding: Text encoding (default: utf-8)
    """
    # Ensure parent directory exists
    path.parent.mkdir(parents=True, exist_ok=True)

    # Create temp file in same directory (for atomic rename)
    fd, temp_path = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp"
    )

    try:
        # Write content to temp file
        with os.fdopen(fd, 'w', encoding=encoding) as f:
            f.write(content)

        # Atomic rename
        os.replace(temp_path, path)

    except Exception:
        # Clean up temp file on error
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def atomic_write_json(
    path: Path,
    data: Dict[str, Any],
    indent: int = 2,
    encoding: str = 'utf-8'
) -> None:
    """
    Write JSON to file atomically.

    Args:
        path: Target file path
        data: Data to serialize as JSON
        indent: JSON indentation (default: 2)
        encoding: Text encoding (default: utf-8)
    """
    content = json.dumps(data, indent=indent, ensure_ascii=False)
    atomic_write_text(path, content, encoding=encoding)


def atomic_write_binary(path: Path, content: bytes) -> None:
    """
    Write binary data to file atomically.

    Args:
        path: Target file path
        content: Binary content to write
    """
    # Ensure parent directory exists
    path.parent.mkdir(parents=True, exist_ok=True)

    # Create temp file in same directory
    fd, temp_path = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp"
    )

    try:
        # Write content to temp file
        with os.fdopen(fd, 'wb') as f:
            f.write(content)

        # Atomic rename
        os.replace(temp_path, path)

    except Exception:
        # Clean up temp file on error
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def atomic_update_json(
    path: Path,
    update_fn: Callable[[Dict[str, Any]], Dict[str, Any]],
    default: Dict[str, Any] = None,
    indent: int = 2
) -> None:
    """
    Update JSON file atomically with a function.

    Reads existing JSON, applies update function, writes back atomically.

    Args:
        path: Target file path
        update_fn: Function that takes current data and returns updated data
        default: Default data if file doesn't exist
        indent: JSON indentation (default: 2)
    """
    # Read current data
    if path.exists():
        with open(path, 'r') as f:
            data = json.load(f)
    else:
        data = default if default is not None else {}

    # Apply update
    updated_data = update_fn(data)

    # Write back atomically
    atomic_write_json(path, updated_data, indent=indent)


def safe_copy(src: Path, dst: Path, overwrite: bool = False) -> None:
    """
    Safely copy file with optional overwrite protection.

    Args:
        src: Source file path
        dst: Destination file path
        overwrite: If False, raises error if destination exists

    Raises:
        FileExistsError: If destination exists and overwrite=False
        FileNotFoundError: If source doesn't exist
    """
    if not src.exists():
        raise FileNotFoundError(f"Source file not found: {src}")

    if dst.exists() and not overwrite:
        raise FileExistsError(f"Destination already exists: {dst}")

    # Ensure destination directory exists
    dst.parent.mkdir(parents=True, exist_ok=True)

    # Copy with metadata
    shutil.copy2(src, dst)


def safe_move(src: Path, dst: Path, overwrite: bool = False) -> None:
    """
    Safely move file with optional overwrite protection.

    Args:
        src: Source file path
        dst: Destination file path
        overwrite: If False, raises error if destination exists

    Raises:
        FileExistsError: If destination exists and overwrite=False
        FileNotFoundError: If source doesn't exist
    """
    if not src.exists():
        raise FileNotFoundError(f"Source file not found: {src}")

    if dst.exists() and not overwrite:
        raise FileExistsError(f"Destination already exists: {dst}")

    # Ensure destination directory exists
    dst.parent.mkdir(parents=True, exist_ok=True)

    # Move file
    shutil.move(str(src), str(dst))
