'use client';

import { useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/utils';
import type { TrackIssueWithStatus } from '@/lib/track-data';

interface IssuesCalendarProps {
  issues: TrackIssueWithStatus[];
  locale: string;
  labels: {
    prev: string;
    next: string;
    today: string;
    unscheduled: string;
    noAssignee: string;
  };
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

function isoDay(d: Date): number {
  return d.getDay();
}

function sameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function parseDate(iso: string): Date | null {
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function IssuesCalendar({ issues, locale, labels }: IssuesCalendarProps) {
  const [current, setCurrent] = useState(() => startOfMonth(new Date()));
  const today = new Date();

  const { scheduled, unscheduled } = useMemo(() => {
    const scheduled: Array<{ date: Date; issues: TrackIssueWithStatus[] }> = [];
    const unscheduled: TrackIssueWithStatus[] = [];
    issues.forEach((issue) => {
      if (!issue.due_date) {
        unscheduled.push(issue);
        return;
      }
      const d = parseDate(issue.due_date);
      if (!d) {
        unscheduled.push(issue);
        return;
      }
      const key = d.toDateString();
      const existing = scheduled.find((s) => s.date.toDateString() === key);
      if (existing) existing.issues.push(issue);
      else scheduled.push({ date: d, issues: [issue] });
    });
    return { scheduled, unscheduled };
  }, [issues]);

  const year = current.getFullYear();
  const month = current.getMonth();
  const totalDays = daysInMonth(year, month);
  const firstDay = isoDay(new Date(year, month, 1));
  const days: Date[] = [];
  for (let i = 0; i < firstDay; i++) days.push(new Date(year, month, i - firstDay + 1));
  for (let i = 1; i <= totalDays; i++) days.push(new Date(year, month, i));
  const remainder = (7 - (days.length % 7)) % 7;
  for (let i = 1; i <= remainder; i++) days.push(new Date(year, month + 1, i));

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="track-calendar">
      <div className="track-calendar-header">
        <div className="track-calendar-title">
          {current.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
        </div>
        <div className="track-calendar-nav">
          <button type="button" onClick={() => setCurrent((d) => addMonths(d, -1))}>
            {labels.prev}
          </button>
          <button type="button" onClick={() => setCurrent(startOfMonth(new Date()))}>
            {labels.today}
          </button>
          <button type="button" onClick={() => setCurrent((d) => addMonths(d, 1))}>
            {labels.next}
          </button>
        </div>
      </div>

      <div className="track-calendar-grid">
        {weekDays.map((d) => (
          <div key={d} className="track-calendar-weekday">
            {d}
          </div>
        ))}
        {days.map((date, idx) => {
          const isCurrentMonth = date.getMonth() === month;
          const isToday = sameDate(date, today);
          const dayIssues = scheduled.filter((s) => sameDate(s.date, date)).flatMap((s) => s.issues);
          return (
            <div
              key={idx}
              className={['track-calendar-day', isCurrentMonth ? 'current' : 'muted', isToday ? 'today' : '']
                .filter(Boolean)
                .join(' ')}
            >
              <span className="track-calendar-day-number">{date.getDate()}</span>
              {dayIssues.length > 0 && (
                <div className="track-calendar-day-issues">
                  {dayIssues.slice(0, 3).map((issue) => (
                    <Link
                      key={issue.id}
                      href={`/${locale}/app/track/issues/${issue.id}`}
                      className="track-calendar-issue"
                      title={issue.title}
                    >
                      <span className="track-identifier">{issue.identifier}</span>
                      <span className="track-calendar-issue-title">{issue.title}</span>
                    </Link>
                  ))}
                  {dayIssues.length > 3 && (
                    <span className="track-calendar-more">+{dayIssues.length - 3} more</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {unscheduled.length > 0 && (
        <div className="track-calendar-unscheduled">
          <p className="track-calendar-unscheduled-title">{labels.unscheduled}</p>
          <div className="track-calendar-unscheduled-list">
            {unscheduled.map((issue) => (
              <Link
                key={issue.id}
                href={`/${locale}/app/track/issues/${issue.id}`}
                className="track-calendar-issue"
              >
                <span className="track-identifier">{issue.identifier}</span>
                <span className="track-calendar-issue-title">{issue.title}</span>
                <span className="track-calendar-issue-assignee">
                  {issue.assignee_name ?? labels.noAssignee}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
