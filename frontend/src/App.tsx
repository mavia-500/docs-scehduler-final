/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  Calendar,
  Clock,
  Truck,
  LayoutDashboard,
  Plus,
  ChevronLeft,
  ChevronRight,
  User,
  Lock,
  Eye,
  EyeOff,
  Phone,
  Hash,
  FileText,
  Settings,
  Edit,
  Trash2,
  X,
} from "lucide-react";
import {
  format,
  addMinutes,
  startOfDay,
  isSameDay,
  parseISO,
  setHours,
  setMinutes,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  addDays,
  addMonths,
  subMonths,
  isToday,
} from "date-fns";
import { motion, AnimatePresence } from "motion/react";
import { extractPlanningFromText } from "./services/geminiService";
import {
  fetchBookings,
  createBookings,
  updateBooking,
  deleteBooking,
  connectBookingWebSocket,
  BookingConflictError,
  BookingCreatePayload,
} from "./services/api";
import { Booking, Dock } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkHours {
  start: number;
  end: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SLOT_DURATION_MINS = 30;
const TRUCKS_PER_SLOT = 3;

const INITIAL_DOCKS: Dock[] = [
  { id: "dock-1", name: "Dock 01", enabled: true },
  { id: "dock-2", name: "Dock 02", enabled: true },
  { id: "dock-3", name: "Dock 03", enabled: true },
  { id: "dock-4", name: "Dock 04", enabled: true },
];

const PRESET_HOLIDAYS: Record<string, { label: string; dates: string[] }> = {
  NL: {
    label: "Netherlands",
    dates: [
      "2025-01-01",
      "2025-04-18",
      "2025-04-21",
      "2025-12-25",
      "2025-12-26",
    ],
  },
};

function dedupeBookings(bookings: Booking[]) {
  return Array.from(
    new Map(bookings.map((booking) => [booking.id, booking])).values(),
  );
}

interface LoginScreenProps {
  onLogin: (username: string, password: string) => void;
  loginError: string;
}

function LoginScreen({ onLogin, loginError }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onLogin(username.trim(), password);
  };

  return (
    <div className="fixed inset-0 bg-zinc-900 flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md rounded-3xl bg-white shadow-2xl overflow-hidden"
      >
        <div className="bg-slate-900 px-8 py-8 text-white">
          <h1 className="text-2xl font-bold uppercase tracking-[0.35em]">
            DOCK SCHEDULER
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            Terminal Operations · Secure Access
          </p>
        </div>
        <form onSubmit={handleSubmit} className="px-8 py-8 space-y-6">
          <div className="space-y-2">
            <label
              htmlFor="username"
              className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400"
            >
              <User className="w-3.5 h-3.5 text-slate-400" />
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400"
            >
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute inset-y-0 right-3 flex items-center text-slate-500"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {loginError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {loginError}
            </div>
          ) : null}

          <button
            type="submit"
            className="w-full bg-indigo-600 text-white py-3 rounded-xl uppercase font-bold tracking-widest hover:bg-indigo-700 transition-colors"
          >
            AUTHENTICATE
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Weekly View ──────────────────────────────────────────────────────────────

function WeeklyView({
  selectedDate,
  bookings,
  holidays,
  workHours,
  docks,
  onDayClick,
}: {
  selectedDate: Date;
  bookings: Booking[];
  holidays: string[];
  workHours: WorkHours;
  docks: Dock[];
  onDayClick: (date: Date) => void;
}) {
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({
    start: weekStart,
    end: addDays(weekStart, 6),
  });
  const activeDocks = docks.filter((d) => d.enabled);

  const slotsPerDay =
    (workHours.end - workHours.start) * (60 / SLOT_DURATION_MINS);
  const maxPerDock = slotsPerDay * TRUCKS_PER_SLOT;

  const getBookingsForDay = (date: Date) =>
    bookings.filter((b) => isSameDay(parseISO(b.startTime), date));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className="grid bg-slate-50/30 border-b border-slate-100 shrink-0"
        style={{ gridTemplateColumns: `80px repeat(7, 1fr)` }}
      >
        <div className="p-2 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest border-r border-slate-100 italic">
          DOCK
        </div>
        {weekDays.map((day) => {
          const isHol = holidays.includes(format(day, "yyyy-MM-dd"));
          return (
            <div
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className={`p-2 text-center border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-slate-50 transition-colors ${
                isToday(day) ? "bg-indigo-50" : isHol ? "bg-red-50" : ""
              }`}
            >
              <p
                className={`text-[10px] font-black uppercase tracking-widest ${isToday(day) ? "text-indigo-600" : "text-slate-500"}`}
              >
                {format(day, "EEE")}
              </p>
              <p
                className={`text-lg font-black mt-0.5 ${isToday(day) ? "text-indigo-600" : "text-slate-700"}`}
              >
                {format(day, "d")}
              </p>
              {(day.getDay() === 0 || day.getDay() === 6) && (
                <p className="text-[8px] text-slate-400 uppercase font-bold mt-0.5">
                  Closed
                </p>
              )}
              {isHol && (
                <p className="text-[8px] text-red-400 uppercase font-bold mt-0.5">
                  Holiday
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeDocks.map((dock) => (
          <div
            key={dock.id}
            className="grid border-b border-slate-100 min-h-20"
            style={{ gridTemplateColumns: `80px repeat(7, 1fr)` }}
          >
            <div className="p-3 flex items-center justify-center border-r border-slate-100 bg-slate-50/30">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                {dock.name}
              </span>
            </div>
            {weekDays.map((day) => {
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              const isHol = holidays.includes(format(day, "yyyy-MM-dd"));
              const dayBookings = getBookingsForDay(day).filter(
                (b) => b.dockId === dock.id,
              );
              const fillPct = Math.min(
                Math.round((dayBookings.length / maxPerDock) * 100),
                100,
              );

              return (
                <div
                  key={day.toISOString()}
                  className={`p-2 border-r border-slate-100 last:border-r-0 flex flex-col gap-1 cursor-pointer ${
                    isHol
                      ? "bg-red-50/50"
                      : isWeekend
                        ? "bg-slate-50/60"
                        : isToday(day)
                          ? "bg-indigo-50/30"
                          : ""
                  }`}
                  onClick={() => onDayClick(day)}
                >
                  {isWeekend || isHol ? (
                    <div className="flex items-center justify-center h-full opacity-40">
                      <span
                        className={`text-[9px] font-bold uppercase ${isHol ? "text-red-400" : "text-slate-400"}`}
                      >
                        {isHol ? "Holiday" : "—"}
                      </span>
                    </div>
                  ) : dayBookings.length === 0 ? (
                    <div className="flex items-center justify-center h-full opacity-30">
                      <span className="text-[9px] font-bold text-emerald-600 uppercase">
                        Free
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-0.5">
                        {dayBookings.slice(0, 4).map((b) => (
                          <div
                            key={b.id}
                            title={`${b.requesterName} • ${format(parseISO(b.startTime), "HH:mm")} • ${b.licensePlate}`}
                            className={`text-[7px] font-bold px-1 py-0.5 rounded truncate max-w-full 
  ${getBookingColors(b).badge}`}
                          >
                            {format(parseISO(b.startTime), "HH:mm")}{" "}
                            {b.requesterName}
                          </div>
                        ))}
                        {dayBookings.length > 4 && (
                          <div className="text-[7px] font-bold text-slate-400 px-1">
                            +{dayBookings.length - 4} more
                          </div>
                        )}
                      </div>
                      <div className="mt-auto">
                        <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              fillPct >= 80
                                ? "bg-red-400"
                                : fillPct >= 40
                                  ? "bg-amber-400"
                                  : "bg-emerald-400"
                            }`}
                            style={{ width: `${fillPct}%` }}
                          />
                        </div>
                        <p className="text-[8px] text-slate-400 font-bold mt-0.5 text-right">
                          {fillPct}%
                        </p>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Monthly View ─────────────────────────────────────────────────────────────

function MonthlyView({
  selectedDate,
  bookings,
  holidays,
  docks,
  workHours,
  onDayClick,
}: {
  selectedDate: Date;
  bookings: Booking[];
  holidays: string[];
  docks: Dock[];
  workHours: WorkHours;
  onDayClick: (date: Date) => void;
}) {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calDays = eachDayOfInterval({ start: calStart, end: calEnd });
  const activeDocks = docks.filter((d) => d.enabled);
  const slotsPerDay =
    (workHours.end - workHours.start) * (60 / SLOT_DURATION_MINS);
  const maxForDay = slotsPerDay * TRUCKS_PER_SLOT * activeDocks.length;
  console.log(bookings);
  const getBookingsForDay = (date: Date) =>
    bookings.filter((b) => isSameDay(parseISO(b.startTime), date));

  return (
    <div className="flex flex-col h-full p-4">
      <div className="grid grid-cols-7 mb-2">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-black text-slate-400 uppercase tracking-widest py-1"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1 gap-1">
        {calDays.map((day) => {
          const inMonth = day.getMonth() === selectedDate.getMonth();
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const isHol = holidays.includes(format(day, "yyyy-MM-dd"));
          const dayBookings = getBookingsForDay(day);
          const fillPct = Math.min(
            Math.round((dayBookings.length / maxForDay) * 100),
            100,
          );
          const selected = isSameDay(day, selectedDate);

          return (
            <div
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className={`rounded-xl p-2 flex flex-col cursor-pointer transition-all border ${
                selected
                  ? "border-indigo-400 bg-indigo-50"
                  : isHol
                    ? "border-red-200 bg-red-50"
                    : isToday(day)
                      ? "border-indigo-200 bg-indigo-50/40"
                      : "border-slate-100 hover:border-slate-200 hover:bg-slate-50"
              } ${!inMonth ? "opacity-30" : ""} ${isWeekend && inMonth ? "bg-slate-50/50" : ""}`}
            >
              <div className="flex justify-between items-start mb-1">
                <span
                  className={`text-xs font-black ${isToday(day) ? "text-indigo-600" : inMonth ? "text-slate-700" : "text-slate-400"}`}
                >
                  {format(day, "d")}
                </span>
                {dayBookings.length > 0 && (
                  <span className="text-[8px] font-black text-indigo-500 bg-indigo-100 px-1 py-0.5 rounded-full">
                    {dayBookings.length}
                  </span>
                )}
              </div>
              {isHol ? (
                <span className="text-[7px] font-bold text-red-400 uppercase">
                  Holiday
                </span>
              ) : isWeekend ? (
                <span className="text-[7px] font-bold text-slate-300 uppercase">
                  Closed
                </span>
              ) : dayBookings.length > 0 ? (
                <>
                  <div className="flex flex-wrap gap-0.5 flex-1">
                    {dayBookings.slice(0, 2).map((b) => (
                      <div
                        key={b.id}
                        className={`text-[6px] font-bold px-0.5 rounded truncate w-full 
  ${getBookingColors(b).chip}`}
                      >
                        {b.requesterName}
                      </div>
                    ))}
                    {dayBookings.length > 2 && (
                      <span className="text-[6px] text-slate-400 font-bold">
                        +{dayBookings.length - 2}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 w-full bg-slate-100 h-0.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${fillPct >= 80 ? "bg-red-400" : fillPct >= 40 ? "bg-amber-400" : "bg-emerald-400"}`}
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                </>
              ) : (
                <span className="text-[7px] font-bold text-emerald-400 uppercase">
                  Free
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Settings Modal ───────────────────────────────────────────────────────────

function SettingsModal({
  docks,
  workHours,
  holidays,
  onSave,
  onClose,
}: {
  docks: Dock[];
  workHours: WorkHours;
  holidays: string[];
  onSave: (docks: Dock[], workHours: WorkHours, holidays: string[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"docks" | "hours" | "holidays">("docks");
  const [localDocks, setLocalDocks] = useState<Dock[]>(
    docks.map((d) => ({ ...d })),
  );
  const [localHours, setLocalHours] = useState<WorkHours>({ ...workHours });
  const [localHolidays, setLocalHolidays] = useState<string[]>([...holidays]);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [hoursError, setHoursError] = useState("");

  const handleSave = () => {
    if (localHours.start >= localHours.end) {
      setHoursError("Start hour must be less than end hour.");
      setTab("hours");
      return;
    }
    onSave(localDocks, localHours, localHolidays);
  };

  const addHoliday = () => {
    if (newHolidayDate && !localHolidays.includes(newHolidayDate)) {
      setLocalHolidays((prev) => [...prev, newHolidayDate].sort());
      setNewHolidayDate("");
    }
  };

  const importPreset = (key: string) => {
    const preset = PRESET_HOLIDAYS[key];
    if (!preset) return;
    setLocalHolidays((prev) => {
      const merged = [...prev];
      preset.dates.forEach((d) => {
        if (!merged.includes(d)) merged.push(d);
      });
      return merged.sort();
    });
  };

  return (
    <div className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="bg-slate-900 p-6 text-white flex justify-between items-start">
          <div>
            <h3 className="text-xl font-bold tracking-tight">SETTINGS</h3>
            <p className="text-[10px] font-bold uppercase opacity-50 tracking-widest mt-1">
              Docks · Work Hours · Holiday Calendar
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100">
          {(["docks", "hours", "holidays"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
                tab === t
                  ? "text-indigo-600 border-b-2 border-indigo-600"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              {t === "docks"
                ? "Dock Schedules"
                : t === "hours"
                  ? "Work Hours"
                  : "Holidays"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-6 max-h-[55vh] overflow-y-auto">
          {/* ── Dock Schedules Tab ── */}
          {tab === "docks" && (
            <div className="space-y-1">
              <p className="text-[10px] text-slate-400 mb-4 leading-relaxed">
                Toggle docks on/off and rename them. Disabled docks are hidden
                from the schedule grid.
              </p>
              {localDocks.map((dock, i) => (
                <div
                  key={dock.id}
                  className="flex items-center gap-3 py-3 border-b border-slate-100 last:border-0"
                >
                  <input
                    type="checkbox"
                    checked={dock.enabled}
                    onChange={(e) =>
                      setLocalDocks((prev) =>
                        prev.map((d, idx) =>
                          idx === i ? { ...d, enabled: e.target.checked } : d,
                        ),
                      )
                    }
                    className="w-4 h-4 accent-indigo-600 cursor-pointer"
                  />
                  <input
                    value={dock.name}
                    onChange={(e) =>
                      setLocalDocks((prev) =>
                        prev.map((d, idx) =>
                          idx === i ? { ...d, name: e.target.value } : d,
                        ),
                      )
                    }
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <span
                    className={`text-[9px] font-bold px-2 py-1 rounded-lg uppercase ${
                      dock.enabled
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {dock.enabled ? "Active" : "Off"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── Work Hours Tab ── */}
          {tab === "hours" && (
            <div className="space-y-4">
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Set the operating hours for all docks. Slots are generated in{" "}
                {SLOT_DURATION_MINS}-minute intervals within this range.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Start Hour (0–23)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={localHours.start}
                    onChange={(e) => {
                      setLocalHours((h) => ({
                        ...h,
                        start: parseInt(e.target.value) || 0,
                      }));
                      setHoursError("");
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    End Hour (1–24)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={localHours.end}
                    onChange={(e) => {
                      setLocalHours((h) => ({
                        ...h,
                        end: parseInt(e.target.value) || 1,
                      }));
                      setHoursError("");
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>
              {hoursError && (
                <p className="text-xs text-red-500 font-medium">{hoursError}</p>
              )}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <p className="text-xs text-slate-500">
                  Preview:{" "}
                  <span className="font-bold text-slate-700">
                    {String(localHours.start).padStart(2, "0")}:00 –{" "}
                    {String(localHours.end).padStart(2, "0")}:00
                  </span>{" "}
                  ={" "}
                  <span className="font-bold text-indigo-600">
                    {(localHours.end - localHours.start) *
                      (60 / SLOT_DURATION_MINS)}{" "}
                    slots
                  </span>{" "}
                  per dock per day
                </p>
              </div>
            </div>
          )}

          {/* ── Holidays Tab ── */}
          {tab === "holidays" && (
            <div className="space-y-4">
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Add individual holiday dates or import preset national
                calendars. Holiday dates are blocked and shown as closed on the
                schedule.
              </p>

              {/* Add single date */}
              <div className="flex gap-2">
                <input
                  type="date"
                  value={newHolidayDate}
                  onChange={(e) => setNewHolidayDate(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <button
                  onClick={addHoliday}
                  disabled={!newHolidayDate}
                  className="px-4 py-2.5 bg-red-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-red-600 disabled:opacity-40 transition-colors"
                >
                  + Add
                </button>
              </div>

              {/* Preset imports */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                  Quick Import by Country
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(PRESET_HOLIDAYS).map(([key, val]) => (
                    <button
                      key={key}
                      onClick={() => importPreset(key)}
                      className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-all text-left"
                    >
                      🗓 {val.label} ({val.dates.length} dates)
                    </button>
                  ))}
                </div>
              </div>

              {/* Current list */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                  Current Holidays ({localHolidays.length})
                </p>
                {localHolidays.length === 0 ? (
                  <p className="text-xs italic text-slate-400">
                    No holidays configured.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {localHolidays.map((d) => (
                      <div
                        key={d}
                        className="flex items-center justify-between bg-red-50 border border-red-100 rounded-lg px-3 py-2"
                      >
                        <span className="text-xs font-bold text-red-700">
                          {d}
                        </span>
                        <button
                          onClick={() =>
                            setLocalHolidays((prev) =>
                              prev.filter((x) => x !== d),
                            )
                          }
                          className="p-1 hover:bg-red-100 rounded-lg transition-colors"
                        >
                          <X className="w-3 h-3 text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-slate-100">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all"
          >
            Apply Changes
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Amend Modal ──────────────────────────────────────────────────────────────

function AmendModal({
  booking,
  docks,
  workHours,
  onSave,
  onDelete,
  onClose,
}: {
  booking: Booking;
  docks: Dock[];
  workHours: WorkHours;
  onSave: (updated: Booking) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const startDate = parseISO(booking.startTime);
  const [date, setDate] = useState(format(startDate, "yyyy-MM-dd"));
  const [time, setTime] = useState(format(startDate, "HH:mm"));
  const [dockId, setDockId] = useState(booking.dockId);
  const [requesterName, setRequesterName] = useState(booking.requesterName);
  const [truckReference, setTruckReference] = useState(booking.truckReference);
  const [driverName, setDriverName] = useState(booking.driverName);
  const [driverPhone, setDriverPhone] = useState(booking.driverPhone);
  const [licensePlate, setLicensePlate] = useState(booking.licensePlate);
  const [direction, setDirection] = useState<"inbound" | "outbound">(
    booking.direction || "inbound",
  );
  // Build allowed times for the select
  const allowedTimes: string[] = [];
  for (let h = workHours.start; h < workHours.end; h++) {
    for (let m = 0; m < 60; m += SLOT_DURATION_MINS) {
      allowedTimes.push(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      );
    }
  }

  const handleSave = () => {
    const newStart = parseISO(`${date}T${time}:00`);
    const newEnd = addMinutes(newStart, SLOT_DURATION_MINS);
    onSave({
      ...booking,
      dockId,
      startTime: newStart.toISOString(),
      endTime: newEnd.toISOString(),
      requesterName,
      truckReference,
      driverName,
      driverPhone,
      licensePlate,
      direction,
    });
  };

  return (
    <div className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
      >
        <div className="bg-amber-600 p-6 text-white">
          <h3 className="text-xl font-bold tracking-tight">AMEND BOOKING</h3>
          <p className="text-[10px] font-bold uppercase opacity-60 tracking-widest mt-1">
            ID: {booking.id} · {booking.type}
          </p>
        </div>

        <div className="p-8 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Reschedule */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-800 mb-3">
              Reschedule
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  New Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  New Time
                </label>
                <select
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                >
                  {allowedTimes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2 mt-4">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Dock
              </label>
              <select
                value={dockId}
                onChange={(e) => setDockId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              >
                {docks
                  .filter((d) => d.enabled)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Direction
              </label>
              <div className="flex gap-3">
                <label
                  className="flex items-center gap-2 cursor-pointer flex-1 
      bg-orange-50 border border-orange-200 rounded-xl px-4 py-3"
                >
                  <input
                    type="radio"
                    name="amendDirection"
                    value="inbound"
                    checked={direction === "inbound"}
                    onChange={() => setDirection("inbound")}
                    className="accent-orange-500"
                  />
                  <span className="text-sm font-bold text-orange-700">
                    Inbound
                  </span>
                </label>
                <label
                  className="flex items-center gap-2 cursor-pointer flex-1 
      bg-purple-50 border border-purple-200 rounded-xl px-4 py-3"
                >
                  <input
                    type="radio"
                    name="amendDirection"
                    value="outbound"
                    checked={direction === "outbound"}
                    onChange={() => setDirection("outbound")}
                    className="accent-purple-500"
                  />
                  <span className="text-sm font-bold text-purple-700">
                    Outbound
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="h-px bg-slate-100" />

          {/* Update Details */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-800 mb-3">
              Update Details
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                  <User className="w-3 h-3" /> Requester
                </label>
                <input
                  value={requesterName}
                  onChange={(e) => setRequesterName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Reference ID
                </label>
                <input
                  value={truckReference}
                  onChange={(e) => setTruckReference(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                  <User className="w-3 h-3" /> Driver Name
                </label>
                <input
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Phone
                </label>
                <input
                  value={driverPhone}
                  onChange={(e) => setDriverPhone(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
            </div>
            <div className="space-y-2 mt-4">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                <Hash className="w-3 h-3" /> License Plate
              </label>
              <input
                value={licensePlate}
                onChange={(e) => setLicensePlate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-8 pb-8">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onDelete(booking.id)}
            className="px-6 py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-red-100 transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-6 py-3 bg-amber-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-amber-600 shadow-lg shadow-amber-200 transition-all"
          >
            Save Changes
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function getBookingColors(booking: Booking) {
  if (booking.direction === "outbound") {
    return {
      card: "bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100",
      dot: "bg-purple-500",
      badge: "bg-purple-100 text-purple-700 border border-purple-200",
      chip: "bg-purple-100 text-purple-700",
    };
  }
  // inbound (default)
  return {
    card: "bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100",
    dot: "bg-orange-500",
    badge: "bg-orange-100 text-orange-700 border border-orange-200",
    chip: "bg-orange-100 text-orange-700",
  };
}
// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<"requester" | "inbound">("requester");
  const [calView, setCalView] = useState<"day" | "week" | "month">("day");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedSlot, setSelectedSlot] = useState<{
    dockId: string;
    time: Date;
  } | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState("");
  const [loginError, setLoginError] = useState("");

  const handleLogin = (username: string, password: string) => {
    console.log(`"${username}" | "${password}"`);
    const credentials: Record<string, string> = {
      admin: "dock2024",
      operator: "shift123",
    };

    const normalizedUsername = username.trim().toLowerCase();
    const normalizedPassword = password.trim();

    if (credentials.admin === username && credentials.operator === password) {
      setIsAuthenticated(true);
      setCurrentUser(normalizedUsername);
      setLoginError("");
      return;
    }

    setLoginError("Invalid credentials. Please try again.");
  };

  // New feature states
  const [docks, setDocks] = useState<Dock[]>(INITIAL_DOCKS);
  const [workHours, setWorkHours] = useState<WorkHours>({ start: 7, end: 15 });
  const [holidays, setHolidays] = useState<string[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [amendingBooking, setAmendingBooking] = useState<Booking | null>(null);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let mounted = true;

    async function loadBookings() {
      try {
        const initial = await fetchBookings();
        if (!mounted) return;
        setBookings(dedupeBookings(initial));
      } catch (error) {
        console.error("Failed to load bookings", error);
        setApiError(
          error instanceof Error ? error.message : "Unable to load bookings",
        );
      }
    }

    setApiError(null);
    loadBookings();

    const disconnect = connectBookingWebSocket({
      onInit: (serverBookings) => {
        if (!mounted) return;
        setBookings(dedupeBookings(serverBookings));
      },
      onCreated: (booking) => {
        setBookings((prev) => dedupeBookings([...prev, booking]));
      },
      onUpdated: (booking) => {
        setBookings((prev) =>
          prev.map((item) => (item.id === booking.id ? booking : item)),
        );
      },
      onDeleted: (id) => {
        setBookings((prev) => prev.filter((item) => item.id !== id));
      },
      onError: (error) => {
        console.error("WebSocket booking error", error);
        setApiError(error.message);
      },
    });

    return () => {
      mounted = false;
      // disconnect();
    };
  }, []);

  const activeDocks = useMemo(() => docks.filter((d) => d.enabled), [docks]);

  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();
    const headers = [
      "Booking ID",
      "Dock",
      "Start Time",
      "End Time",
      "Requester",
      "Reference",
      "Driver",
      "Phone",
      "License Plate",
      "Type",
      "Created At",
    ];
    const rows = bookings.map((b) => [
      b.id,
      b.dockId,
      b.startTime,
      b.endTime,
      b.requesterName,
      b.truckReference,
      b.driverName,
      b.driverPhone,
      b.licensePlate,
      b.type,
      b.createdAt,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, "Bookings");
    XLSX.writeFile(
      wb,
      `dock-schedule-${format(new Date(), "yyyy-MM-dd")}.xlsx`,
    );
  };

  const timeSlots = useMemo(() => {
    const slots: Date[] = [];
    let current = setMinutes(
      setHours(startOfDay(selectedDate), workHours.start),
      0,
    );
    const end = setHours(startOfDay(selectedDate), workHours.end);
    while (current < end) {
      slots.push(new Date(current));
      current = addMinutes(current, SLOT_DURATION_MINS);
    }
    return slots;
  }, [selectedDate, workHours]);

  const handlePrev = () => {
    if (calView === "day") setSelectedDate((d) => addMinutes(d, -1440));
    else if (calView === "week") setSelectedDate((d) => addDays(d, -7));
    else setSelectedDate((d) => subMonths(d, 1));
  };
  const handleNext = () => {
    if (calView === "day") setSelectedDate((d) => addMinutes(d, 1440));
    else if (calView === "week") setSelectedDate((d) => addDays(d, 7));
    else setSelectedDate((d) => addMonths(d, 1));
  };
  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
    setCalView("day");
  };

  const isWeekendDay =
    selectedDate.getDay() === 0 || selectedDate.getDay() === 6;
  const isHolidayDay = holidays.includes(format(selectedDate, "yyyy-MM-dd"));

  const todayBookingsCount = bookings.filter((b) =>
    isSameDay(parseISO(b.startTime), selectedDate),
  ).length;
  const maxSlots = activeDocks.length * timeSlots.length * TRUCKS_PER_SLOT;
  const workloadPercent = Math.min(
    Math.round((todayBookingsCount / maxSlots) * 100),
    100,
  );

  const headerDateLabel = useMemo(() => {
    if (calView === "day") return format(selectedDate, "EEEE, MMM do");
    if (calView === "week") {
      const ws = startOfWeek(selectedDate, { weekStartsOn: 1 });
      const we = addDays(ws, 6);
      return `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
    }
    return format(selectedDate, "MMMM yyyy");
  }, [calView, selectedDate]);

  const handleBooking = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedSlot) return;

    setApiError(null);
    const formData = new FormData(e.currentTarget);
    const truckCount = Math.max(
      1,
      parseInt(formData.get("truckCount") as string) || 1,
    );
    const direction = formData.get("direction") as "inbound" | "outbound"; // 👈 YEH LINE ADD KAREIN

    const payloads: BookingCreatePayload[] = [];
    const startTime = selectedSlot.time;
    const endTime = addMinutes(startTime, SLOT_DURATION_MINS);

    for (let i = 0; i < truckCount; i++) {
      payloads.push({
        dockId: selectedSlot.dockId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        // direction: direction,
        requesterName: (formData.get("requesterName") as string) || "",
        truckReference:
          truckCount > 1
            ? `${formData.get("truckReference") as string} (#${i + 1})`
            : (formData.get("truckReference") as string),
        driverName: (formData.get("driverName") as string) || "",
        driverPhone: (formData.get("driverPhone") as string) || "",
        licensePlate: (formData.get("licensePlate") as string) || "",
        type: "manual",
        direction: direction ?? "inbound", // 👈 YEH BHI ADD KAREIN
      });
    }

    try {
      const createdBookings = await createBookings(payloads);
      setBookings((prev) => dedupeBookings([...prev, ...createdBookings]));
      setIsBookingModalOpen(false);
      setSelectedSlot(null);
    } catch (error) {
      if (error instanceof BookingConflictError) {
        setApiError(error.message);
        return;
      }
      console.error("Booking creation failed", error);
      setApiError(
        error instanceof Error
          ? error.message
          : "Unable to create booking. Please try again.",
      );
    }
  };

  const handleAmendSave = async (updated: Booking) => {
    setApiError(null);
    try {
      const saved = await updateBooking(updated.id, {
        dockId: updated.dockId,
        startTime: updated.startTime,
        endTime: updated.endTime,
        requesterName: updated.requesterName,
        truckReference: updated.truckReference,
        driverName: updated.driverName,
        driverPhone: updated.driverPhone,
        licensePlate: updated.licensePlate,
        type: updated.type,
        direction: updated.direction ?? "inbound", // 👈 ADD KAREIN
      });
      setBookings((prev) => prev.map((b) => (b.id === saved.id ? saved : b)));
      setAmendingBooking(null);
      setSelectedSlot(null);
    } catch (error) {
      if (error instanceof BookingConflictError) {
        setApiError(error.message);
        return;
      }
      console.error("Failed to update booking", error);
      setApiError(
        error instanceof Error
          ? error.message
          : "Unable to update booking. Please try again.",
      );
    }
  };

  const handleAmendDelete = async (id: string) => {
    setApiError(null);
    try {
      await deleteBooking(id);
      setBookings((prev) => prev.filter((b) => b.id !== id));
      setAmendingBooking(null);
      setSelectedSlot(null);
    } catch (error) {
      console.error("Failed to delete booking", error);
      setApiError(
        error instanceof Error
          ? error.message
          : "Unable to delete booking. Please try again.",
      );
    }
  };

  const handleSettingsSave = (
    newDocks: Dock[],
    newHours: WorkHours,
    newHolidays: string[],
  ) => {
    setDocks(newDocks);
    setWorkHours(newHours);
    setHolidays(newHolidays);
    setIsSettingsOpen(false);
    setSelectedSlot(null);
  };

  const handleAIExtract = async () => {
    setIsExtracting(true);
    try {
      // 1. CALL THE GEMINI FUNCTION (instead of using regex)
      // This sends the whole block of text to the AI to handle the "messy" parts
      const extractedData = await extractPlanningFromText(aiInput);

      if (extractedData && extractedData.length > 0) {
        const payloads: BookingCreatePayload[] = [];

        extractedData.forEach((item: any) => {
          const truckCount = Math.max(1, item.truckCount || 1);
          const [h, m] = (item.suggestedTime || "09:00").split(":").map(Number);

          const baseStart = new Date(selectedDate);
          baseStart.setHours(h, m, 0, 0);

          for (let i = 0; i < truckCount; i++) {
            const startTime = baseStart;
            const dockIndex =
              (payloads.length + bookings.length) % activeDocks.length;
            const dock = activeDocks[dockIndex] || activeDocks[0];

            if (dock) {
              payloads.push({
                dockId: dock.id,
                startTime: startTime.toISOString(),
                endTime: addMinutes(
                  startTime,
                  SLOT_DURATION_MINS,
                ).toISOString(),
                requesterName: item.requesterName || "Unknown Carrier",
                truckReference:
                  item.truckReference ||
                  `AI-${Math.random().toString(36).toUpperCase().slice(0, 4)}`,
                driverName: item.driverName || "TBD",
                driverPhone: item.driverPhone || "N/A",
                licensePlate: item.licensePlate || "PENDING",
                type: "automatic",
                direction: item.direction ?? "inbound",
              });
            }
          }
        });

        try {
          const createdBookings = await createBookings(payloads);
          setBookings((prev) => dedupeBookings([...prev, ...createdBookings]));
          setIsAIModalOpen(false);
          setAiInput("");
        } catch (error) {
          if (error instanceof BookingConflictError) {
            setApiError(error.message);
          } else {
            console.error("AI booking creation failed", error);
            setApiError(
              error instanceof Error
                ? error.message
                : "Unable to create AI-suggested bookings.",
            );
          }
        }
      } else {
        alert(
          "The AI couldn't find any booking details. Try being a bit more specific!",
        );
      }
    } catch (error) {
      console.error("Extraction error:", error);
      alert("Failed to connect to AI. Please check your API key.");
    } finally {
      setIsExtracting(false);
    }
  };

  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} loginError={loginError} />;
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-slate-900 font-sans p-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 uppercase">
            Dock Scheduler
          </h1>
          <p className="text-sm text-slate-500 font-medium">
            Terminal Hub • {headerDateLabel}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
            <div
              className={`w-2 h-2 rounded-full ${bookings.length > 0 ? "bg-emerald-500" : "bg-amber-500"} animate-pulse`}
            />
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
              {bookings.length > 0 ? "DATA STREAM: ACTIVE" : "SYSTEM IDLE"}
            </span>
          </div>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 bg-white border border-slate-200 shadow-sm px-3 py-1.5 rounded-lg text-[10px] font-bold text-slate-600 uppercase tracking-wider hover:bg-slate-50 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" /> Settings
          </button>

          <div className="flex bg-white rounded-xl border border-slate-200 shadow-sm p-1">
            <button
              onClick={() => setView("requester")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${view === "requester" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-600"}`}
            >
              BOOKING
            </button>
            <button
              onClick={() => setView("inbound")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${view === "inbound" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-600"}`}
            >
              Docs Details
            </button>
          </div>

          <div className="flex bg-white rounded-xl border border-slate-200 shadow-sm p-1">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setCalView(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all capitalize ${calView === v ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-600"}`}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
            <button
              onClick={handlePrev}
              className="p-1.5 hover:bg-slate-50 rounded-lg"
            >
              <ChevronLeft className="w-4 h-4 text-slate-400" />
            </button>
            <button
              onClick={handleNext}
              className="p-1.5 hover:bg-slate-50 rounded-lg"
            >
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          <button
            onClick={exportToExcel}
            className="group relative overflow-hidden rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-emerald-200 transition-all duration-300 hover:-translate-y-0.5 hover:bg-emerald-700 active:scale-[0.98] cursor-pointer"
          >
            <span className="relative flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Export Excel
            </span>
          </button>
        </div>
      </header>

      {/* Bento Layout */}
      <div className="grid grid-cols-12 grid-rows-6 gap-4 h-[calc(100vh-140px)]">
        {/* Left Column */}
        <div className="col-span-3 row-span-6 flex flex-col gap-4">
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Today's Workload
              </h3>
              <div className="text-3xl font-black text-indigo-600">
                {todayBookingsCount}{" "}
                <span className="text-lg font-normal text-slate-400">
                  / {maxSlots}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Confirmed bookings across all docks
              </p>
            </div>
            <div className="space-y-2 mt-4">
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-500 h-full transition-all duration-500"
                  style={{ width: `${workloadPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                <span>{String(workHours.start).padStart(2, "0")}:00</span>
                <span>{workloadPercent}% Utilization</span>
                <span>{String(workHours.end).padStart(2, "0")}:00</span>
              </div>
            </div>
          </div>

          <div className="flex-1 bg-emerald-500 text-white rounded-2xl p-5 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                  AI Integration
                </h3>
                <div className="bg-white/20 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase">
                  Ready
                </div>
              </div>
              <p className="text-xs font-medium leading-tight mb-4">
                Automatically extract bookings from planning notes or container
                lists.
              </p>
            </div>
            <button
              onClick={() => setIsAIModalOpen(true)}
              className="w-full bg-white text-emerald-600 py-2.5 rounded-xl text-xs font-bold shadow-lg hover:bg-emerald-50 transition-colors"
            >
              SYNC FROM DOCUMENT
            </button>
          </div>

          <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm overflow-hidden flex flex-col">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">
              Operations Log
            </h3>
            <div className="space-y-3 flex-1 overflow-y-auto pr-2">
              {bookings
                .slice(-5)
                .reverse()
                .map((b) => (
                  <div
                    key={b.id}
                    className="flex gap-3 items-start animate-in fade-in slide-in-from-left-2 duration-300"
                  >
                    <div
                      className={`w-1.5 h-1.5 mt-1.5 rounded-full ${getBookingColors(b).dot}`}
                    />
                    <div>
                      <p className="text-[10px] leading-tight text-slate-600">
                        <span className="font-bold">
                          {format(parseISO(b.createdAt), "HH:mm")}
                        </span>{" "}
                        Slot {format(parseISO(b.startTime), "HH:mm")} (
                        {b.dockId.split("-")[1]
                          ? `Dock ${b.dockId.split("-")[1]}`
                          : b.dockId}
                        ) {b.type === "automatic" ? "synced" : "booked"}
                      </p>
                      <p className="text-[9px] text-slate-400 uppercase mt-0.5">
                        {b.licensePlate}
                      </p>
                    </div>
                  </div>
                ))}
              {bookings.length === 0 && (
                <p className="text-[10px] italic text-slate-400">
                  Waiting for activity...
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Center Column */}
        <div className="col-span-6 row-span-6 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              {calView === "day" && "Dock Availability (30m Intervals)"}
              {calView === "week" && "Weekly Overview — All Docks"}
              {calView === "month" &&
                `Monthly Overview — ${format(selectedDate, "MMMM yyyy")}`}
            </h3>
            <div className="flex gap-4 text-[9px] font-bold text-slate-500 tracking-wider">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-100 border border-orange-400" />{" "}
                INBOUND
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-100 border border-purple-400" />{" "}
                OUTBOUND
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-100 border border-amber-400" />{" "}
                PARTIAL
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-100 border border-red-400" />{" "}
                FULL
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-200 border border-red-500" />{" "}
                HOLIDAY
              </div>
            </div>
          </div>

          {/* Day View */}
          {calView === "day" && (
            <>
              <div
                className="grid bg-slate-50/30 border-b border-slate-100 shrink-0"
                style={{
                  gridTemplateColumns: `80px repeat(${activeDocks.length}, 1fr)`,
                }}
              >
                <div className="p-2 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest border-r border-slate-100 italic">
                  TIME
                </div>
                {activeDocks.map((dock) => (
                  <div
                    key={dock.id}
                    className="p-2 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest border-r border-slate-100 last:border-r-0"
                  >
                    {dock.name}
                  </div>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 relative">
                {/* Weekend Overlay */}
                {isWeekendDay && (
                  <div className="absolute inset-0 z-20 bg-slate-50/80 backdrop-blur-[2px] flex flex-col items-center justify-center p-12 text-center">
                    <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4">
                      <Calendar className="w-8 h-8 text-slate-400" />
                    </div>
                    <h4 className="text-lg font-bold text-slate-800 uppercase tracking-tight">
                      Terminal Closed
                    </h4>
                    <p className="text-sm text-slate-500 mt-2 max-w-xs leading-relaxed">
                      Dock operations are only available Monday through Friday.
                    </p>
                  </div>
                )}

                {/* Holiday Overlay */}
                {!isWeekendDay && isHolidayDay && (
                  <div className="absolute inset-0 z-20 bg-red-50/90 backdrop-blur-[2px] flex flex-col items-center justify-center p-12 text-center">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                      <Calendar className="w-8 h-8 text-red-400" />
                    </div>
                    <h4 className="text-lg font-bold text-red-700 uppercase tracking-tight">
                      Holiday — Terminal Closed
                    </h4>
                    <p className="text-sm text-red-400 mt-2 max-w-xs leading-relaxed">
                      {format(selectedDate, "MMMM do, yyyy")} is a scheduled
                      holiday. No bookings available.
                    </p>
                  </div>
                )}

                {timeSlots.map((time) => (
                  <div
                    key={time.toISOString()}
                    className="border-b border-slate-100 last:border-0 group min-h-12"
                    style={{
                      display: "grid",
                      gridTemplateColumns: `80px repeat(${activeDocks.length}, 1fr)`,
                    }}
                  >
                    <div
                      className={`p-4 font-mono text-[10px] font-bold items-center justify-center flex border-r border-slate-100 transition-colors ${format(time, "HH:mm") === format(new Date(), "HH:mm") ? "bg-indigo-50 text-indigo-600" : "bg-slate-50/30 text-slate-400"}`}
                    >
                      {format(time, "HH:mm")}
                    </div>
                    {activeDocks.map((dock) => {
                      const currentBookings = bookings.filter((b) => {
                        // 1. Log the types to debug

                        // 2. Perform the checks and return the boolean result
                        return (
                          b.dockId === dock.id &&
                          isSameDay(parseISO(b.startTime), time) &&
                          format(parseISO(b.startTime), "HH:mm") ===
                            format(time, "HH:mm")
                        );
                      });
                      // console.log(currentBookings);

                      const isFull = currentBookings.length >= TRUCKS_PER_SLOT;
                      const isSelected =
                        selectedSlot?.dockId === dock.id &&
                        format(selectedSlot.time, "HH:mm") ===
                          format(time, "HH:mm");

                      return (
                        <div
                          key={dock.id}
                          className={`p-1 border-r border-slate-100 last:border-r-0 relative group/slot transition-all ${isSelected ? "bg-indigo-50/50" : ""}`}
                        >
                          {currentBookings.length > 0 ? (
                            <div className="h-full w-full flex flex-col gap-1">
                              {view === "inbound" ? (
                                <div className="h-full w-full flex flex-col justify-center px-1">
                                  <div className="flex justify-between items-center mb-1">
                                    <span
                                      className={`text-[7px] font-black uppercase ${isFull ? "text-red-600" : "text-amber-600"}`}
                                    >
                                      {isFull ? "OCCUPIED" : "PARTIAL"}
                                    </span>
                                    <span className="text-[7px] font-bold text-slate-400">
                                      {currentBookings.length}/{TRUCKS_PER_SLOT}
                                    </span>
                                  </div>
                                  <div className="flex gap-0.5 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                    {Array.from({
                                      length: TRUCKS_PER_SLOT,
                                    }).map((_, i) => (
                                      <div
                                        key={i}
                                        className={`flex-1 h-full ${i < currentBookings.length ? (isFull ? "bg-red-500" : "bg-amber-500") : "bg-transparent"}`}
                                      />
                                    ))}
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-0.5">
                                    {currentBookings.map((b) => (
                                      <div
                                        key={b.id}
                                        className="text-[6px] font-bold truncate max-w-full text-slate-500 bg-white/50 px-0.5 rounded cursor-help"
                                        title={b.requesterName}
                                      >
                                        {b.requesterName}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                currentBookings.map((b) => (
                                  <motion.div
                                    initial={{ scale: 0.95, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    key={b.id}
                                    onClick={() => setAmendingBooking(b)}
                                    title="Click to amend"
                                    className={`flex-1 p-1 rounded border flex items-center justify-center 
  text-[8px] font-black uppercase transition-all shadow-sm cursor-pointer 
  group/chip ${getBookingColors(b).card}`}
                                  >
                                    <Edit className="w-2.5 h-2.5 mr-1 opacity-0 group-hover/chip:opacity-100 transition-opacity" />
                                    {b.requesterName}
                                  </motion.div>
                                ))
                              )}
                              {!isFull && view === "requester" && (
                                <button
                                  onClick={() => {
                                    setSelectedSlot({ dockId: dock.id, time });
                                    setIsBookingModalOpen(true);
                                  }}
                                  className="flex-1 border border-dashed border-slate-300 rounded opacity-0 group-hover/slot:opacity-100 bg-white/50 flex items-center justify-center transition-opacity"
                                >
                                  <Plus className="w-2.5 h-2.5 text-slate-400" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="h-full w-full flex items-center justify-center">
                              {view === "requester" ? (
                                <button
                                  onClick={() => {
                                    setSelectedSlot({ dockId: dock.id, time });
                                    setIsBookingModalOpen(true);
                                  }}
                                  className="w-full h-full bg-emerald-50/30 rounded opacity-0 group-hover/slot:opacity-100 hover:bg-emerald-100/50 flex items-center justify-center transition-all cursor-pointer"
                                >
                                  <Plus className="w-4 h-4 text-emerald-500" />
                                </button>
                              ) : (
                                <div className="h-full w-full flex flex-col justify-center px-1 opacity-40">
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="text-[7px] font-black uppercase text-emerald-600">
                                      AVAILABLE
                                    </span>
                                    <span className="text-[7px] font-bold text-slate-400">
                                      0/{TRUCKS_PER_SLOT}
                                    </span>
                                  </div>
                                  <div className="w-full h-1.5 bg-slate-100 rounded-full border border-slate-200/50" />
                                </div>
                              )}
                            </div>
                          )}
                          {isSelected && (
                            <div className="absolute inset-0 bg-indigo-600 border border-indigo-700 rounded-sm z-2 flex flex-col items-center justify-center text-[8px] font-black text-white uppercase shadow-lg">
                              SELECTED
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}

          {calView === "week" && (
            <WeeklyView
              selectedDate={selectedDate}
              bookings={bookings}
              holidays={holidays}
              workHours={workHours}
              docks={docks}
              onDayClick={handleDayClick}
            />
          )}

          {calView === "month" && (
            <MonthlyView
              selectedDate={selectedDate}
              bookings={bookings}
              holidays={holidays}
              docks={docks}
              workHours={workHours}
              onDayClick={handleDayClick}
            />
          )}
        </div>

        {/* Right Column */}
        <div className="col-span-3 row-span-6 flex flex-col gap-4">
          <div className="flex-2 bg-slate-900 text-white rounded-2xl p-6 shadow-xl flex flex-col">
            <div className="mb-6">
              <h3 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">
                Slot Intelligence
              </h3>
              <div className="text-xl font-bold tracking-tight">
                Active Selection
              </div>
              <p className="text-[10px] text-slate-400 mt-1 uppercase font-semibold">
                Terminal Operations Center
              </p>
            </div>

            <div className="space-y-4 flex-1 overflow-y-auto">
              {selectedSlot ? (
                <div className="space-y-4 animate-in fade-in zoom-in-95">
                  <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">
                      Current Slot
                    </label>
                    <div className="text-sm font-bold flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-indigo-400" />
                      {format(selectedSlot.time, "HH:mm")} –{" "}
                      {format(
                        addMinutes(selectedSlot.time, SLOT_DURATION_MINS),
                        "HH:mm",
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                      <LayoutDashboard className="w-3.5 h-3.5" />
                      {docks.find((d) => d.id === selectedSlot.dockId)?.name}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest px-1">
                      Occupancy
                    </label>
                    {bookings.filter(
                      (b) =>
                        b.dockId === selectedSlot.dockId &&
                        format(parseISO(b.startTime), "HH:mm") ===
                          format(selectedSlot.time, "HH:mm"),
                    ).length === 0 ? (
                      <div className="bg-indigo-500/10 p-4 rounded-xl border border-indigo-500/30 border-dashed text-center">
                        <p className="text-[10px] italic text-indigo-200/50 mb-3">
                          No bookings assigned to this slot yet.
                        </p>
                        <button
                          onClick={() => setIsBookingModalOpen(true)}
                          className="w-full bg-indigo-500 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-indigo-400 transition-colors"
                        >
                          ASSIGN NOW
                        </button>
                      </div>
                    ) : (
                      bookings
                        .filter(
                          (b) =>
                            b.dockId === selectedSlot.dockId &&
                            format(parseISO(b.startTime), "HH:mm") ===
                              format(selectedSlot.time, "HH:mm"),
                        )
                        .map((b) => (
                          <div
                            key={b.id}
                            className="bg-slate-800 p-3 rounded-xl border border-slate-700 relative group overflow-hidden"
                          >
                            <div className="flex justify-between items-center mb-2">
                              <div className="text-[8px] font-black text-indigo-400 uppercase">
                                {b.truckReference}
                              </div>
                              <div
                                className={`w-1.5 h-1.5 rounded-full ${getBookingColors(b).dot}`}
                              />
                            </div>
                            <div className="text-sm font-bold truncate">
                              {b.requesterName}
                            </div>
                            <div className="flex flex-col gap-1 mt-2">
                              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                <User className="w-3 h-3" /> {b.driverName}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-indigo-300">
                                <Truck className="w-3 h-3" /> {b.licensePlate}
                              </div>
                            </div>
                            <button
                              onClick={() => setAmendingBooking(b)}
                              className="absolute -right-10 group-hover:right-14 top-2 p-1.5 bg-amber-500/10 text-amber-400 rounded-lg transition-all hover:bg-amber-500 hover:text-white"
                              title="Amend booking"
                            >
                              <Edit className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() =>
                                setBookings((prev) =>
                                  prev.filter((item) => item.id !== b.id),
                                )
                              }
                              className="absolute -right-10 group-hover:right-2 top-2 p-1.5 bg-red-500/10 text-red-400 rounded-lg transition-all hover:bg-red-500 hover:text-white"
                            >
                              <Plus className="w-3 h-3 rotate-45" />
                            </button>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
                  <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center mb-4">
                    <Clock className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-xs font-bold uppercase tracking-widest">
                    Select a slot
                  </p>
                  <p className="text-[10px] px-8 mt-2 leading-relaxed">
                    Click any timeline window to view details or create a
                    booking.
                  </p>
                </div>
              )}
            </div>

            <div className="pt-6 border-t border-slate-800 mt-4 space-y-3">
              <div className="flex justify-between items-center text-[10px] uppercase font-black tracking-widest text-slate-500">
                <span>Database</span>
                <span className="text-emerald-500">Local Only</span>
              </div>
              <button
                disabled={!selectedSlot}
                onClick={() => setIsBookingModalOpen(true)}
                className="w-full bg-white text-slate-900 py-3 rounded-xl text-xs font-black shadow-lg hover:bg-slate-100 transition-all disabled:opacity-50 tracking-widest"
              >
                PROCEED WITH BOOKING
              </button>
            </div>
          </div>

          <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 font-black">
                  {currentUser.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-xs font-bold">{currentUser}</p>
                  <p className="text-[10px] text-slate-400">
                    Secure Dashboard Access
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsAuthenticated(false);
                  setCurrentUser("");
                  setLoginError("");
                }}
                className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-700"
              >
                LOGOUT
              </button>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                Operator
              </p>
              <p className="text-[12px] font-bold text-slate-700">
                Terminal Specialist
              </p>
              <p className="text-[10px] text-slate-400 mt-1">
                Shift A • Bay 4-12
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {/* Booking Modal */}
        {isBookingModalOpen && (
          <div className="fixed inset-0 overflow-y-auto bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="bg-slate-900 p-6 text-white">
                <h3 className="text-xl font-bold tracking-tight">
                  CREATE BOOKING
                </h3>

                <div className="flex gap-4 mt-2 text-[10px] font-black uppercase opacity-60 tracking-widest">
                  <div className="flex items-center gap-2">
                    <LayoutDashboard className="w-3 h-3" />
                    {docks.find((d) => d.id === selectedSlot?.dockId)?.name}
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    {selectedSlot && format(selectedSlot.time, "HH:mm")} –{" "}
                    {selectedSlot &&
                      format(
                        addMinutes(selectedSlot.time, SLOT_DURATION_MINS),
                        "HH:mm",
                      )}
                  </div>
                </div>
                {apiError ? (
                  <div className="mb-4 mt-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 shadow-sm">
                    <strong className="font-bold">
                      Real-time booking error:{" "}
                    </strong>
                    <span>{apiError}</span>
                  </div>
                ) : null}
              </div>
              <form
                onSubmit={handleBooking}
                className="p-8 space-y-6 overflow-y-auto relative z-100"
              >
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    + <Truck className="w-3 h-3" /> Direction
                  </label>

                  <div className="flex gap-3">
                    <label
                      className="flex items-center gap-2 cursor-pointer flex-1 
    bg-orange-50 border border-orange-200 rounded-xl px-4 py-3"
                    >
                      <input
                        type="radio"
                        name="direction"
                        value="inbound" // 👈 yeh alag
                        defaultChecked
                        className="accent-orange-500"
                      />
                      <span className="text-sm font-bold text-orange-700">
                        Inbound
                      </span>
                    </label>

                    <label
                      className="flex items-center gap-2 cursor-pointer flex-1 
    bg-purple-50 border border-purple-200 rounded-xl px-4 py-3"
                    >
                      <input
                        type="radio"
                        name="direction"
                        value="outbound" // 👈 yeh alag
                        className="accent-purple-500"
                      />
                      <span className="text-sm font-bold text-purple-700">
                        Outbound
                      </span>
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                      <User className="w-3 h-3" />
                      Requester
                    </label>
                    <input
                      name="requesterName"
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      placeholder="e.g. Global Logistics"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                      <Truck className="w-3 h-3" />
                      No. of Trucks
                    </label>
                    <input
                      name="truckCount"
                      type="number"
                      min="1"
                      max="10"
                      defaultValue="1"
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <FileText className="w-3 h-3" />
                    Reference ID
                  </label>
                  <input
                    name="truckReference"
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="PO-123456"
                  />
                </div>
                <div className="h-px bg-slate-100" />
                <div className="space-y-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-800">
                    Operational Details
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                        <User className="w-3 h-3" />
                        Driver Name
                      </label>
                      <input
                        name="driverName"
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        placeholder="Full Name"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                        <Phone className="w-3 h-3" />
                        Contact #
                      </label>
                      <input
                        name="driverPhone"
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        placeholder="+1..."
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                      <Hash className="w-3 h-3" />
                      License Plate
                    </label>
                    <input
                      name="licensePlate"
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      placeholder="ABC-1234"
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsBookingModalOpen(false)}
                    className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-colors"
                  >
                    Discard
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all"
                  >
                    Confirm
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* AI Modal */}
        {isAIModalOpen && (
          <div className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="bg-indigo-600 p-6 text-white">
                <h3 className="text-xl font-bold tracking-tight uppercase">
                  AI PLANNING SYNC
                </h3>
                <p className="text-[10px] font-black uppercase tracking-widest opacity-70 mt-1">
                  Extract automation from manifest or notes
                </p>

                {/* <p className="mt-5 font-bold"> */}
                {/* The Prompt must be in that format <br /> */}
                {/* 08:00 AB Logistics 2 trucks */}
                {/* 12:30 Zenith Transport 5 units */}
                {/* </p> */}
              </div>

              <div className="p-8 space-y-6">
                <textarea
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  className="w-full h-40 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none text-slate-600 leading-relaxed"
                  placeholder="08:00 AB Logistics 2 trucks..."
                />
                <div className="flex gap-3">
                  <button
                    disabled={isExtracting}
                    onClick={() => setIsAIModalOpen(false)}
                    className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={isExtracting || !aiInput.trim()}
                    onClick={handleAIExtract}
                    className="flex-1 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isExtracting ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      "Execute Sync"
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Settings Modal */}
        {isSettingsOpen && (
          <SettingsModal
            docks={docks}
            workHours={workHours}
            holidays={holidays}
            onSave={handleSettingsSave}
            onClose={() => setIsSettingsOpen(false)}
          />
        )}

        {/* Amend Modal */}
        {amendingBooking && (
          <AmendModal
            booking={amendingBooking}
            docks={docks}
            workHours={workHours}
            onSave={handleAmendSave}
            onDelete={handleAmendDelete}
            onClose={() => setAmendingBooking(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
