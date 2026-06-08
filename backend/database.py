"""
database.py — SQLite schema and connection helper.
Notes and evaluations are persisted permanently.
Sessions are in-memory only (transient workflow state).
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "smart_notes.db"


def get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = get_db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS notes (
        id          TEXT PRIMARY KEY,
        subject     TEXT NOT NULL,
        unit        TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        content_md  TEXT NOT NULL,
        source_files TEXT NOT NULL,   -- JSON array of filenames
        image_count INTEGER DEFAULT 0,
        token_estimate INTEGER DEFAULT 0,
        eval_scores TEXT,             -- JSON object or NULL
        pdf_path    TEXT
    );

    CREATE TABLE IF NOT EXISTS rag_chunks (
        id          TEXT PRIMARY KEY,
        note_id     TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        heading     TEXT,
        content     TEXT NOT NULL,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS evaluations (
        id              TEXT PRIMARY KEY,
        note_id         TEXT NOT NULL,
        evaluated_at    TEXT NOT NULL,
        scores          TEXT NOT NULL,       -- JSON
        flagged_sentences TEXT,              -- JSON array
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rag_messages (
        id          TEXT PRIMARY KEY,
        note_id     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        role        TEXT NOT NULL,   -- 'user' | 'assistant' | 'prompt'
        content     TEXT NOT NULL,
        retrieved   TEXT,            -- JSON array of {heading, snippet} or NULL
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );
    """)
    conn.commit()
    conn.close()
