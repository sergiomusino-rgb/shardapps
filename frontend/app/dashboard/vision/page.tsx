"use client";
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';

interface Event {
  id: string;
  title: string;
  date: string;
  time?: string;
  color: string;
}

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<Event[]>([
    { id: '1', title: 'Riunione cliente', date: '2026-06-27', time: '10:00', color: '#6366f1' },
    { id: '2', title: 'Scadenza fattura', date: '2026-06-30', color: '#ef4444' },
    { id: '3', title: 'Appuntamento dottore', date: '2026-07-02', time: '15:30', color: '#10b981' },
  ]);
  const [showModal, setShowModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [newEvent, setNewEvent] = useState({ title: '', time: '', color: '#6366f1' });
  const { t } = useLanguage();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDay = firstDay.getDay();

  const monthNames = [
    t('month_jan'), t('month_feb'), t('month_mar'), t('month_apr'), 
    t('month_may'), t('month_jun'), t('month_jul'), t('month_aug'), 
    t('month_sep'), t('month_oct'), t('month_nov'), t('month_dec')
  ];
  const dayNames = [t('day_sun'), t('day_mon'), t('day_tue'), t('day_wed'), t('day_thu'), t('day_fri'), t('day_sat')];

  const goToPreviousMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const goToNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToToday = () => setCurrentDate(new Date());

  const handleDayClick = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDate(dateStr);
    setShowModal(true);
  };

  const handleAddEvent = () => {
    if (!newEvent.title || !selectedDate) return;
    
    const event: Event = {
      id: Date.now().toString(),
      title: newEvent.title,
      date: selectedDate,
      time: newEvent.time || undefined,
      color: newEvent.color,
    };

    setEvents([...events, event]);
    setNewEvent({ title: '', time: '', color: '#6366f1' });
    setShowModal(false);
  };

  const handleDeleteEvent = (id: string) => {
    setEvents(events.filter(e => e.id !== id));
  };

  const getEventsForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter(e => e.date === dateStr);
  };

  const isToday = (day: number) => {
    const today = new Date();
    return today.getDate() === day && today.getMonth() === month && today.getFullYear() === year;
  };

  const renderCalendar = () => {
    const days = [];
    const totalCells = Math.ceil((startingDay + daysInMonth) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
      const dayNumber = i - startingDay + 1;
      
      if (dayNumber < 1 || dayNumber > daysInMonth) {
        days.push(
          <div key={`empty-${i}`} className="h-32 bg-slate-900/30 border border-slate-800/50"></div>
        );
      } else {
        const dayEvents = getEventsForDay(dayNumber);
        days.push(
          <div 
            key={`day-${dayNumber}`}
            onClick={() => handleDayClick(dayNumber)}
            className={`h-32 p-2 border border-slate-800 hover:bg-slate-800/30 cursor-pointer transition ${
              isToday(dayNumber) ? 'bg-indigo-500/10 border-indigo-500/50' : 'bg-slate-900/50'
            }`}
          >
            <div className="flex justify-between items-start mb-1">
              <span className={`text-sm font-medium ${isToday(dayNumber) ? 'text-indigo-400' : 'text-slate-400'}`}>
                {dayNumber}
              </span>
            </div>
            <div className="space-y-1 overflow-hidden">
              {dayEvents.slice(0, 3).map((event) => (
                <div 
                  key={event.id}
                  className="text-xs px-2 py-1 rounded truncate"
                  style={{ background: `${event.color}20`, color: event.color, borderLeft: `3px solid ${event.color}` }}
                >
                  {event.time && <span className="font-medium">{event.time}</span>} {event.title}
                </div>
              ))}
              {dayEvents.length > 3 && (
                <div className="text-xs text-slate-500 px-2">
                  {t('calendar_more_events').replace('{count}', String(dayEvents.length - 3))}
                </div>
              )}
            </div>
          </div>
        );
      }
    }
    return days;
  };

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">{t('calendar_title')}</h1>
            <p className="text-slate-400 mt-1">{t('calendar_subtitle')}</p>
          </div>
          <button
            onClick={() => {
              setSelectedDate(new Date().toISOString().split('T')[0]);
              setShowModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium transition"
          >
            <Plus size={18} />
            {t('calendar_new_event')}
          </button>
        </div>

        {/* Calendar Controls */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <button
              onClick={goToPreviousMonth}
              className="p-2 hover:bg-slate-800 rounded-lg transition"
            >
              <ChevronLeft size={20} />
            </button>
            <h2 className="text-xl font-semibold min-w-[200px] text-center">
              {monthNames[month]} {year}
            </h2>
            <button
              onClick={goToNextMonth}
              className="p-2 hover:bg-slate-800 rounded-lg transition"
            >
              <ChevronRight size={20} />
            </button>
          </div>
          <button
            onClick={goToToday}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg font-medium transition"
          >
            {t('calendar_today')}
          </button>
        </div>

        {/* Calendar Grid */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
          {/* Day Headers */}
          <div className="grid grid-cols-7 border-b border-slate-800">
            {dayNames.map((day) => (
              <div key={day} className="p-3 text-center text-sm font-medium text-slate-400 bg-slate-900">
                {day}
              </div>
            ))}
          </div>
          
          {/* Days Grid */}
          <div className="grid grid-cols-7">
            {renderCalendar()}
          </div>
        </div>

        {/* Upcoming Events */}
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-3">{t('calendar_upcoming_events')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {events
              .filter(e => e.date >= new Date().toISOString().split('T')[0])
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(0, 6)
              .map((event) => (
                <div 
                  key={event.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div 
                      className="text-xs px-2 py-1 rounded font-medium"
                      style={{ background: `${event.color}20`, color: event.color }}
                    >
                      {event.time || t('calendar_all_day')}
                    </div>
                    <button
                      onClick={() => handleDeleteEvent(event.id)}
                      className="text-slate-500 hover:text-red-400 transition"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <h4 className="font-semibold mb-1">{event.title}</h4>
                  <p className="text-sm text-slate-400">
                    {new Date(event.date).toLocaleDateString('it-IT', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}
                  </p>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Add Event Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">{t('calendar_new_event_title')}</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-slate-300">
                  {t('calendar_event_title')} <span className="text-red-400">{t('calendar_event_title_required')}</span>
                </label>
                <input
                  type="text"
                  value={newEvent.title}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                  className="w-full p-3 rounded-lg bg-slate-800 border border-slate-700 text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  placeholder={t('calendar_event_placeholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-slate-300">
                  {t('calendar_event_date')}
                </label>
                <input
                  type="text"
                  value={selectedDate}
                  readOnly
                  className="w-full p-3 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-slate-300">
                  {t('calendar_event_time')}
                </label>
                <input
                  type="time"
                  value={newEvent.time}
                  onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })}
                  className="w-full p-3 rounded-lg bg-slate-800 border border-slate-700 text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-slate-300">
                  {t('calendar_event_color')}
                </label>
                <div className="flex gap-2 flex-wrap">
                  {['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'].map((color) => (
                    <button
                      key={color}
                      onClick={() => setNewEvent({ ...newEvent, color })}
                      className={`w-10 h-10 rounded-lg transition ${
                        newEvent.color === color ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''
                      }`}
                      style={{ background: color }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg font-medium transition"
              >
                {t('calendar_cancel')}
              </button>
              <button
                onClick={handleAddEvent}
                className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium transition"
              >
                {t('calendar_create_event')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}