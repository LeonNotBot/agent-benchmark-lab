CREATE TABLE sessions (
        id text primary key,
        claude_session_id text,
        status text not null,
        title text,
        cwd text,
        allowed_tools text,
        last_prompt text,
        created_at integer not null,
        updated_at integer not null
      )

CREATE TABLE stream_items (
        id text primary key,
        session_id text not null,
        kind text not null,
        timestamp integer not null,
        payload text not null,
        foreign key (session_id) references sessions(id)
      )

CREATE TABLE ui_requests (
        id text primary key,
        session_id text not null,
        title text not null,
        prompt text not null,
        mode text not null,
        options text,
        fields text,
        danger integer,
        created_at integer not null,
        resolved_at integer,
        foreign key (session_id) references sessions(id)
      )

CREATE TABLE IF NOT EXISTS channels (
        id text primary key,
        type text not null,
        name text not null,
        enabled integer default 1,
        credentials text not null,
        status text default 'disconnected',
        created_at integer not null,
        updated_at integer not null
      )
