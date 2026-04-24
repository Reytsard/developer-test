// ============================================================
// Launchmen Task API
// Developer Candidate Test — Trial 2
// ============================================================
// Instructions:
//   Run with: npm install && node Test_2_server.js
//   Server starts on: http://localhost:3000
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const DB_FILE = path.join(__dirname, 'Test_2_tasks.json');

function loadTasks() {
  if (!fs.existsSync(DB_FILE)) return [];
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  return JSON.parse(raw);
}

function saveTasks(tasks) {
  fs.writeFileSync(DB_FILE, JSON.stringify(tasks, null, 2));
}

// GET /tasks
// Returns all tasks. Supports optional ?status= query filter.
// Decision: if ?status= is provided as an empty string we treat it as no filter
// (same as omitting the param), because filtering by "" would always return an
// empty array — almost certainly not the caller's intent.
app.get('/tasks', (req, res) => {
  const tasks = loadTasks();
  const { status } = req.query;
  if (status) {
    const filtered = tasks.filter(t => t.status === status);
    return res.json({ success: true, tasks: filtered });
  }
  res.json({ success: true, tasks });
});

// POST /tasks
app.post('/tasks', (req, res) => {
  const { title, status } = req.body;

  // Bug fix: title was not validated — return 400 if missing.
  if (!title) {
    return res.status(400).json({ success: false, message: 'title is required' });
  }

  const tasks = loadTasks();
  const newTask = {
    id: Date.now(),
    title: title,
    // Bug fix: status had no default — use "pending" when not provided.
    status: status || 'pending',
  };
  tasks.push(newTask);
  saveTasks(tasks);

  // Bug fix: was returning implicit 200 — should be 201 for resource creation.
  res.status(201).json({ success: true, task: newTask });
});

// PATCH /tasks/:id
app.patch('/tasks/:id', (req, res) => {
  const tasks = loadTasks();
  const { status } = req.body;

  // Bug fix: req.params.id is always a string but task IDs are numbers (Date.now()).
  // Strict equality (===) never matched, so every PATCH returned 404.
  // Fix: coerce the param to Number before comparing.
  const task = tasks.find(t => t.id === Number(req.params.id));
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }
  task.status = status;
  saveTasks(tasks);
  res.json({ success: true, task });
});

// DELETE /tasks/:id
app.delete('/tasks/:id', (req, res) => {
  let tasks = loadTasks();

  // Bug fix: same string-vs-number type mismatch as PATCH — coerce to Number.
  const index = tasks.findIndex(t => t.id === Number(req.params.id));

  // Bug fix: findIndex returns -1 when not found. Without this guard,
  // tasks.splice(-1, 1) would silently delete the last task instead of 404-ing.
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  // Bug fix: the original code did `tasks = tasks.splice(index, 1)`.
  // Array.splice() returns the *removed* elements, not the remaining array —
  // so saveTasks was persisting only the deleted item. Removed the reassignment;
  // splice mutates the array in place, which is the correct behaviour here.
  tasks.splice(index, 1);
  saveTasks(tasks);
  res.json({ success: true, message: 'Task deleted' });
});

app.listen(3000, () => {
  console.log('Launchmen Task API running on http://localhost:3000');
});

// ============================================================
// TASK 3 — SQL Performance Review  (see performance-issue.md)
// ============================================================
//
// QUESTION 1: Identify the issue — what performance problem does this code have?
//
// This is the N+1 query problem.
// The code runs one query to fetch 50 posts, then executes a *separate* SELECT
// inside a loop for every single post to retrieve its author. That is up to 51
// database round-trips (1 post query + 1 author query × 50 posts).
//
// At  a large scale scenario each request carries network latency and query-parsing overhead,
// and the database has no chance to batch or optimise the work. The page slows
// down because it waits for 50 sequential async calls to complete.
//
// A secondary issue: the author query uses direct string interpolation/inputs
// (`WHERE id = ${post.author_id}`), which is a SQL injection vulnerability.
//
// ─────────────────────────────────────────────────────────────
//
// QUESTION 2: How would you fix it?
//
// Replace the loop with a single JOIN query. The database resolves the author
// relationship in one pass, using the primary-key index on authors.id and
// (ideally) an index on posts.created_at for the ORDER BY + LIMIT.
//
// Fixed code:
//
//   const postsWithAuthors = await db.query(`
//     SELECT
//       p.id,
//       p.author_id,
//       p.title,
//       p.created_at,
//       a.name  AS author_name,
//       a.email AS author_email
//     FROM posts p
//     JOIN authors a ON a.id = p.author_id
//     ORDER BY p.created_at DESC
//     LIMIT 50
//   `);
//
//   return postsWithAuthors;
//
// This is 1 query instead of up to 51. It eliminates string interpolation
// (no SQL injection risk), and lets the query planner use the authors primary
// key index for the join. Add a supporting index if not already present:
//
//   CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
//
//  We can also prevent this vulnerability by using the prepare statement, this method validates and reformats preset commands into database-safe commands
//  an example is when the space character, it will turn into %(value) and it will be turned into a string.
//
// ============================================================
