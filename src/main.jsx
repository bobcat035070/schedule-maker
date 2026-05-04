import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const WEEKDAYS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];
const DAY_LABELS = { M: 'Mon', T: 'Tue', W: 'Wed', Th: 'Thu', F: 'Fri', S: 'Sat', Su: 'Sun' };
const TIME_START = 7 * 60;
const TIME_END = 21 * 60;
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 1000;

function timeToMinutes(value) {
  const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function parseScheduleToken(token) {
  const match = token.match(/^(M|T|W|Th|F|S|Su)\s+(\d{1,2}:\d{2}\s*[AP]M)-(\d{1,2}:\d{2}\s*[AP]M)$/i);
  if (!match) return null;
  return {
    day: match[1],
    start: timeToMinutes(match[2]),
    end: timeToMinutes(match[3]),
  };
}

function formatTime(minutes) {
  const h24 = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, '0');
  const period = h24 >= 12 ? 'PM' : 'AM';
  const hour = ((h24 + 11) % 12) + 1;
  return `${hour}:${m} ${period}`;
}

function extractPdfTextItem(item) {
  return item.str.replace(/\s+/g, ' ').trim();
}

async function readPdfRows(file) {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];

  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
    const rows = new Map();

    for (const item of content.items) {
      const text = extractPdfTextItem(item);
      if (!text) continue;
      const [, , , , x, y] = item.transform;
      const key = Math.round(y / 2) * 2;
      const group = rows.get(key) || [];
      group.push({ text, x });
      rows.set(key, group);
    }

    const orderedRows = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    pages.push(orderedRows);
  }

  return pages.flat();
}

function parseCoursesFromRows(rows) {
  const startIndex = rows.findIndex((row) => /Registered Courses/i.test(row));
  const tableRows = startIndex >= 0 ? rows.slice(startIndex + 1) : rows;
  const courses = [];
  let current = null;

  const isCourseCode = (value) => /^[A-Z]{2,5}\s?\d{3}[A-Z]?$/.test(value);
  const hasSchedule = (value) => /\b(M|T|W|Th|F|S|Su)\s+\d{1,2}:\d{2}\s*[AP]M-\d{1,2}:\d{2}\s*[AP]M\b/i.test(value);

  for (const row of tableRows) {
    const codeMatch = row.match(/^([A-Z]{2,5}\s?\d{3}[A-Z]?)\b\s*(.*)$/);
    if (codeMatch && isCourseCode(codeMatch[1])) {
      if (current && current.lines.length) courses.push(current);
      current = { code: codeMatch[1].replace(/\s+/g, ' ').trim(), lines: [codeMatch[2].trim()].filter(Boolean) };
      continue;
    }

    if (!current) continue;

    if (hasSchedule(row) || current.lines.length) {
      current.lines.push(row);
    }
  }

  if (current && current.lines.length) courses.push(current);

  return courses
    .map((course) => {
      const raw = [course.code, ...course.lines].join(' ').replace(/\s+/g, ' ').trim();
      const scheduleMatches = [...raw.matchAll(/\b(M|T|W|Th|F|S|Su)\s+\d{1,2}:\d{2}\s*[AP]M-\d{1,2}:\d{2}\s*[AP]M\b/gi)].map((match) => match[0]);
      const schedules = scheduleMatches.map(parseScheduleToken).filter(Boolean);

      const scheduleIndex = raw.search(/\b(M|T|W|Th|F|S|Su)\s+\d{1,2}:\d{2}\s*[AP]M-\d{1,2}:\d{2}\s*[AP]M\b/i);
      const preSchedule = scheduleIndex >= 0 ? raw.slice(0, scheduleIndex).trim() : raw;
      const descParts = preSchedule.split(/\s+/).slice(1);
      const dropTail = descParts.findIndex((token) => /^\d+(?:\.\d)?$/.test(token));
      const description = (dropTail >= 0 ? descParts.slice(0, dropTail) : descParts).join(' ').trim() || course.code;

      return {
        code: course.code,
        title: description,
        events: schedules,
      };
    })
    .filter((course) => course.events.length);
}

function colorsForIndex(index) {
  const palette = ['#2563eb', '#7c3aed', '#0f766e', '#dc2626', '#d97706', '#0891b2', '#4f46e5', '#16a34a'];
  return palette[index % palette.length];
}

function ScheduleCanvas({ courses, canvasRef }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    const padding = 72;
    const header = 170;
    const leftGutter = 124;
    const gridTop = padding + header;
    const gridLeft = padding + leftGutter;
    const gridWidth = CANVAS_WIDTH - gridLeft - padding;
    const gridHeight = CANVAS_HEIGHT - gridTop - padding;
    const dayWidth = gridWidth / WEEKDAYS.length;
    const minuteScale = gridHeight / (TIME_END - TIME_START);

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#eff6ff');
    gradient.addColorStop(1, '#ffffff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#111827';
    ctx.font = 'bold 42px Inter, Arial, sans-serif';
    ctx.fillText('Class Schedule', padding, 64);
    ctx.fillStyle = '#4b5563';
    ctx.font = '24px Inter, Arial, sans-serif';
    ctx.fillText('Generated from PDF course data', padding, 102);

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;

    for (let i = 0; i <= WEEKDAYS.length; i += 1) {
      const x = gridLeft + i * dayWidth;
      ctx.beginPath();
      ctx.moveTo(x, gridTop);
      ctx.lineTo(x, gridTop + gridHeight);
      ctx.stroke();
    }

    for (let t = TIME_START; t <= TIME_END; t += 60) {
      const y = gridTop + (t - TIME_START) * minuteScale;
      ctx.beginPath();
      ctx.moveTo(gridLeft, y);
      ctx.lineTo(gridLeft + gridWidth, y);
      ctx.stroke();
      ctx.fillStyle = '#475569';
      ctx.font = '20px Inter, Arial, sans-serif';
      ctx.fillText(formatTime(t), padding, y + 6);
    }

    ctx.font = 'bold 24px Inter, Arial, sans-serif';
    WEEKDAYS.forEach((day, index) => {
      ctx.fillStyle = '#0f172a';
      ctx.fillText(DAY_LABELS[day], gridLeft + index * dayWidth + 16, gridTop - 28);
    });

    const blocksByDay = [];
    courses.forEach((course, courseIndex) => {
      course.events.forEach((event) => {
        blocksByDay.push({ ...event, code: course.code, title: course.title, color: colorsForIndex(courseIndex) });
      });
    });

    const conflictOffsets = new Map();
    blocksByDay.forEach((block) => {
      const key = `${block.day}`;
      const list = conflictOffsets.get(key) || [];
      list.push(block);
      conflictOffsets.set(key, list);
    });

    for (const [day, blocks] of conflictOffsets.entries()) {
      blocks.sort((a, b) => a.start - b.start);
      const assigned = [];
      blocks.forEach((block) => {
        let column = 0;
        while (assigned.some((other) => other.column === column && block.start < other.end && block.end > other.start)) {
          column += 1;
        }
        assigned.push({ ...block, column });
      });

      const maxColumns = Math.max(...assigned.map((item) => item.column + 1), 1);
      assigned.forEach((block) => {
        const dayIndex = WEEKDAYS.indexOf(day);
        if (dayIndex < 0) return;
        const x = gridLeft + dayIndex * dayWidth + 10 + (dayWidth - 20) * (block.column / maxColumns);
        const width = (dayWidth - 26) / maxColumns;
        const y = gridTop + (block.start - TIME_START) * minuteScale + 6;
        const height = Math.max((block.end - block.start) * minuteScale - 10, 32);

        ctx.fillStyle = block.color;
        ctx.globalAlpha = 0.92;
        roundRect(ctx, x, y, width, height, 16);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'top';

        if (height < 52) {
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 13px Inter, Arial, sans-serif';
          ctx.fillText(block.code, x + 8, y + 6);
          ctx.font = '11px Inter, Arial, sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fillText(`${formatTime(block.start)} - ${formatTime(block.end)}`, x + 8, y + 20);
        } else if (height < 80) {
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 15px Inter, Arial, sans-serif';
          ctx.fillText(block.code, x + 10, y + 10);
          ctx.font = '12px Inter, Arial, sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fillText(`${formatTime(block.start)} - ${formatTime(block.end)}`, x + 10, y + 28);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 16px Inter, Arial, sans-serif';
          ctx.fillText(block.code, x + 12, y + 10);
          ctx.font = '13px Inter, Arial, sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          wrapText(ctx, block.title, x + 12, y + 32, width - 24, 15);
          ctx.fillText(`${formatTime(block.start)} - ${formatTime(block.end)}`, x + 12, y + height - 20);
        }
      });
    }
  }, [courses, canvasRef]);

  return <canvas ref={canvasRef} className="schedule-canvas" />;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(' ');
  let line = '';
  let currentY = y;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, x, currentY);
}

function App() {
  const [courses, setCourses] = useState([]);
  const [status, setStatus] = useState('Upload a PDF to generate your schedule.');
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef(null);

  async function handleFile(file) {
    setLoading(true);
    setStatus('Reading PDF...');
    try {
      const rows = await readPdfRows(file);
      const parsed = parseCoursesFromRows(rows);
      setCourses(parsed);
      setStatus(parsed.length ? `Loaded ${parsed.length} course${parsed.length === 1 ? '' : 's'}.` : 'No schedule rows were detected.');
    } catch (error) {
      setStatus(`Could not read PDF: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  function downloadImage() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'schedule.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  const entries = useMemo(() => courses.flatMap((course) => course.events.map((event) => ({ ...event, code: course.code, title: course.title }))), [courses]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Schedule Maker</p>
          <h1>Upload a registration PDF and get a clean weekly image.</h1>
          <p className="lead">This app extracts course schedules, plots them by day and time, and exports a presentable PNG.</p>
        </div>
        <label className="upload-card">
          <input type="file" accept="application/pdf" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <span>{loading ? 'Processing PDF...' : 'Choose PDF file'}</span>
        </label>
      </section>

      <section className="status-bar">{status}</section>

      <section className="layout">
        <div className="panel">
          <div className="panel-header">
            <h2>Preview</h2>
            <button onClick={downloadImage} disabled={!courses.length}>Download PNG</button>
          </div>
          <ScheduleCanvas courses={courses} canvasRef={canvasRef} />
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Detected Courses</h2>
            <span>{entries.length} blocks</span>
          </div>
          <div className="course-list">
            {entries.length ? entries.map((entry, index) => (
              <article key={`${entry.code}-${index}`} className="course-row">
                <strong>{entry.code}</strong>
                <span>{entry.title}</span>
                <small>{DAY_LABELS[entry.day]} {formatTime(entry.start)} - {formatTime(entry.end)}</small>
              </article>
            )) : <p className="empty">No courses parsed yet.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
