
import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { checkConflict, calculateSubjectProgress, getSessionFromPeriod, parseLocal, determineStatus, getSessionSequenceInfo, generateId, base64ToArrayBuffer, getEffectiveTotalPeriods, isSubjectFinished, getCampusId } from '../utils';
import { ScheduleItem, ScheduleStatus, Teacher } from '../types';
import { format, addDays, isSameDay, getWeek } from 'date-fns';
import { vi } from 'date-fns/locale';
import { Calendar as CalendarIcon, Plus, ChevronRight, ChevronLeft, AlertCircle, Save, Trash2, ListFilter, X, Copy, Clipboard, Users, Download, BookOpen, Mail, CalendarOff, Sun, Moon } from 'lucide-react';
import ExcelJS from 'exceljs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import saveAs from 'file-saver';

const DAYS_OF_WEEK = [
  { label: 'Thứ 2', val: 1 },
  { label: 'Thứ 3', val: 2 },
  { label: 'Thứ 4', val: 3 },
  { label: 'Thứ 5', val: 4 },
  { label: 'Thứ 6', val: 5 },
  { label: 'Thứ 7', val: 6 },
  { label: 'CN', val: 0 },
];

const ScheduleManager: React.FC = () => {
  const { schedules, classes, teachers, subjects, templates, holidays, addSchedule, updateSchedule, deleteSchedule } = useApp();
  
  // NEW: Session Filter State
  const [selectedSession, setSelectedSession] = useState<string>('Ban ngày');
  
  // Filter classes based on selected session
  const filteredClassList = useMemo(() => {
      return classes.filter(c => (c.session || 'Ban ngày') === selectedSession);
  }, [classes, selectedSession]);

  // Initialize selectedClassId with the first class of the current session or keep existing if valid
  const [selectedClassId, setSelectedClassId] = useState<string>('');

  // Effect: When Session changes, auto-select the first class of that session
  useEffect(() => {
      if (filteredClassList.length > 0) {
          // Check if current selected ID is valid in the new list
          const exists = filteredClassList.find(c => c.id === selectedClassId);
          if (!exists) {
              setSelectedClassId(filteredClassList[0].id);
          }
      } else {
          setSelectedClassId('');
      }
  }, [selectedSession, filteredClassList]);

  // Initialize on mount if empty
  useEffect(() => {
      if (!selectedClassId && classes.length > 0) {
           const first = classes.find(c => (c.session || 'Ban ngày') === selectedSession);
           if (first) setSelectedClassId(first.id);
           else if (classes.length > 0) setSelectedClassId(classes[0].id);
      }
  }, [classes]);

  const [viewDate, setViewDate] = useState(new Date());
  const [showAddModal, setShowAddModal] = useState(false);
  const [editItem, setEditItem] = useState<ScheduleItem | null>(null);
  
  // State for Drag and Drop
  const [draggedItem, setDraggedItem] = useState<ScheduleItem | null>(null);

  // State for Copy/Paste (Context Menu)
  const [copiedItem, setCopiedItem] = useState<ScheduleItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    show: boolean;
    x: number;
    y: number;
    target?: { date: Date; period: number; item?: ScheduleItem };
  }>({ show: false, x: 0, y: 0 });

  // Form State
  const [formTeacherId, setFormTeacherId] = useState('');
  const [formSubjectId, setFormSubjectId] = useState('');
  const [formType, setFormType] = useState<'class' | 'exam'>('class');
  const [formRoom, setFormRoom] = useState('');
  const [formGroup, setFormGroup] = useState(''); // Group
  const [formDate, setFormDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [formStartPeriod, setFormStartPeriod] = useState(1);
  const [formPeriodCount, setFormPeriodCount] = useState(3);
  const [formError, setFormError] = useState('');
  const [formNote, setFormNote] = useState(''); 

  // Shared Class Selection
  const [selectedSharedClasses, setSelectedSharedClasses] = useState<string[]>([]);

  // Get current class details
  const currentClass = classes.find(c => c.id === selectedClassId);
  
  const getStartOfWeek = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
    return new Date(d.setDate(diff));
  };

  const weekStart = getStartOfWeek(viewDate);
  const weekNumber = getWeek(viewDate);

  // ==========================================
  // VIEW CONFIGURATION (COLUMNS & PERIODS)
  // ==========================================

  // Configure Grid based on Session
  const gridConfig = useMemo(() => {
      // Helper to get date for day index (1=Mon, ..., 6=Sat, 0=Sun)
      // Note: weekStart is always Monday
      const getDayDate = (dayOffset: number) => addDays(weekStart, dayOffset);

      if (selectedSession === 'Ban ngày') {
          // Standard Day View: Mon-Sat, Periods 1-10
          // Keep original behavior as requested
          const cols = [];
          for (let i = 0; i <= 5; i++) { // 0=Mon, 5=Sat
              const d = getDayDate(i);
              cols.push({
                  date: d,
                  label: format(d, 'EEEE', { locale: vi }),
                  subLabel: format(d, 'dd/MM'),
                  periodOffset: 0 // Absolute periods
              });
          }
          return {
              columns: cols,
              rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // Absolute rows
              type: 'standard' // Use standard rendering (grouped by session)
          };
      } else {
          // Evening View: Mon-Sat (Evening) + Sun(Morning) + Sun(Afternoon)
          // Periods 1-4 relative
          const cols = [];
          
          // Mon (0) to Sat (5) - Evening
          for (let i = 0; i <= 5; i++) {
              const d = getDayDate(i);
              cols.push({
                  date: d,
                  label: format(d, 'EEEE', { locale: vi }),
                  subLabel: format(d, 'dd/MM'),
                  periodOffset: 10 // Row 1 -> Period 11
              });
          }

          // Sunday (6)
          const sun = getDayDate(6);
          
          // Sunday Morning
          cols.push({
              date: sun,
              label: 'Sáng CN',
              subLabel: format(sun, 'dd/MM'),
              periodOffset: 0 // Row 1 -> Period 1
          });

          // Sunday Afternoon
          cols.push({
              date: sun,
              label: 'Chiều CN',
              subLabel: format(sun, 'dd/MM'),
              periodOffset: 5 // Row 1 -> Period 6
          });

          return {
              columns: cols,
              rows: [1, 2, 3, 4], // Relative rows
              type: 'matrix' // Use matrix rendering
          };
      }
  }, [selectedSession, weekStart]);

  // Default Start Period for Forms (Initial Value)
  useEffect(() => {
      if (selectedSession === 'Tối') {
          setFormStartPeriod(11);
      } else {
          setFormStartPeriod(1);
      }
  }, [selectedSession]);

  // Helper to check if a date is a holiday
  const getHoliday = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return holidays.find(h => dateStr >= h.startDate && dateStr <= h.endDate);
  };

  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => s.classId === selectedClassId);
  }, [schedules, selectedClassId]);

  // Filter subjects logic
  const availableSubjects = useMemo(() => {
    if (!currentClass) return subjects; 
    
    const currentType = editItem ? editItem.type : formType;
    const isH8 = currentClass.name.toUpperCase().includes('H8');

    return subjects.filter(s => {
        let isEligible = false;
        if (s.majorId === 'common') {
            isEligible = true;
        } else if (s.majorId === 'culture') {
            isEligible = !isH8;
        } else if (s.majorId === 'culture_8') {
            isEligible = isH8;
        } else {
            isEligible = s.majorId === currentClass.majorId;
        }

        if (!isEligible) return false;
        if (editItem && editItem.subjectId === s.id) return true;

        const isFinished = isSubjectFinished(s, currentClass, schedules);

        if (currentType === 'exam') {
             if (!isFinished) return false;
             const relevantSchedules = schedules.filter(sch => sch.subjectId === s.id && sch.classId === currentClass.id);
             const hasExam = relevantSchedules.some(sch => sch.type === 'exam');
             if (hasExam && (!editItem || editItem.subjectId !== s.id)) return false;
             return true;
        } else {
             if (isFinished && s.majorId !== 'culture_8') return false;
             return true;
        }
    });
  }, [subjects, classes, selectedClassId, schedules, editItem, formType, currentClass]);

  // Active Subjects Summary
  const activeSubjectsSummary = useMemo(() => {
    const startOfWeek = weekStart;
    const endOfWeek = addDays(weekStart, 7); // Full week range
    const sStart = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate());
    const sEnd = new Date(endOfWeek.getFullYear(), endOfWeek.getMonth(), endOfWeek.getDate());

    const currentWeekSchedules = schedules.filter(s => {
        if (s.classId !== selectedClassId || s.status === ScheduleStatus.OFF) return false;
        const date = parseLocal(s.date);
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        return d >= sStart && d < addDays(sEnd, 1);
    });

    const uniqueSubjectIds = Array.from(new Set(currentWeekSchedules.map(s => s.subjectId)));
    const newSubjectIds = uniqueSubjectIds.filter(subId => {
        const hasPriorSchedule = schedules.some(s => {
            if (s.subjectId !== subId || s.classId !== selectedClassId || s.status === ScheduleStatus.OFF) return false;
            const date = parseLocal(s.date);
            const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            return d < sStart;
        });
        return !hasPriorSchedule;
    });

    return newSubjectIds.map(subId => {
        const sub = subjects.find(s => s.id === subId);
        const subjectSchedules = currentWeekSchedules.filter(s => s.subjectId === subId).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const latestSchedule = subjectSchedules[0];
        const teacher = teachers.find(t => t.id === latestSchedule?.teacherId);
        const cls = classes.find(c => c.id === selectedClassId);
        
        const effectiveTotal = sub ? getEffectiveTotalPeriods(sub, cls) : 0;

        return {
            id: subId,
            classId: selectedClassId,
            teacherId: teacher?.id,
            subjectName: sub?.name || 'Unknown',
            teacherName: teacher?.name || 'Chưa cập nhật',
            totalPeriods: effectiveTotal,
            className: cls?.name || ''
        };
    });
  }, [schedules, subjects, teachers, classes, selectedClassId, weekStart]);

  // Teacher Recommendation
  const currentSubjectId = editItem ? editItem.subjectId : formSubjectId;
  const { suggestedTeachers, otherTeachers } = useMemo(() => {
    const subj = subjects.find(s => s.id === currentSubjectId);
    if (!subj) return { suggestedTeachers: [], otherTeachers: teachers };

    const responsibleNames = [subj.teacher1, subj.teacher2, subj.teacher3]
        .filter(n => n && n.trim() !== '')
        .map(n => n!.toLowerCase().trim());
    
    if (responsibleNames.length === 0) return { suggestedTeachers: [], otherTeachers: teachers };

    const suggested: Teacher[] = [];
    const others: Teacher[] = [];

    teachers.forEach(t => {
        if (responsibleNames.includes(t.name.toLowerCase().trim())) {
            suggested.push(t);
        } else {
            others.push(t);
        }
    });
    return { suggestedTeachers: suggested, otherTeachers: others };
  }, [currentSubjectId, teachers, subjects]);

  const currentFormSubject = subjects.find(s => s.id === currentSubjectId);
  
  const isFormSubjectShared = useMemo(() => {
      if (!currentFormSubject) return false;
      if (currentFormSubject.isShared) return true;
      if (currentFormSubject.majorId !== 'common' && currentFormSubject.majorId !== 'culture' && currentFormSubject.majorId !== 'culture_8') {
          return classes.some(c => c.id !== selectedClassId && c.majorId === currentFormSubject.majorId);
      }
      return false;
  }, [currentFormSubject, classes, selectedClassId]);

  useEffect(() => {
    if (showAddModal && !editItem) {
        if (!selectedSharedClasses.includes(selectedClassId)) {
            setSelectedSharedClasses([selectedClassId]);
        }
    }
  }, [showAddModal, formSubjectId, selectedClassId]);

  useEffect(() => {
      if (!currentFormSubject) return;
      const mainClass = classes.find(c => c.id === selectedClassId);
      if (!mainClass) return;

      setSelectedSharedClasses(prev => prev.filter(id => {
          if (id === selectedClassId) return true;
          const cls = classes.find(c => c.id === id);
          if (!cls) return false;
          if ((cls.campus || 'Cơ sở 1') !== (mainClass.campus || 'Cơ sở 1')) return false;
          if ((cls.session || 'Ban ngày') !== (mainClass.session || 'Ban ngày')) return false;
          if (currentFormSubject.majorId === 'culture') return !cls.name.toUpperCase().includes('H8');
          if (currentFormSubject.majorId === 'culture_8') return cls.name.toUpperCase().includes('H8');
          if (currentFormSubject.majorId !== 'common') return cls.majorId === currentFormSubject.majorId;
          return true;
      }));
  }, [formSubjectId, classes, selectedClassId, currentFormSubject]);

  useEffect(() => {
    const handleClick = () => setContextMenu({ ...contextMenu, show: false });
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [contextMenu]);

  useEffect(() => {
    if (formSubjectId && !availableSubjects.some(s => s.id === formSubjectId)) {
      setFormSubjectId('');
    }
  }, [availableSubjects, formSubjectId]);

  const handlePrevWeek = () => setViewDate(addDays(viewDate, -7));
  const handleNextWeek = () => setViewDate(addDays(viewDate, 7));

  const resetForm = () => {
    setFormTeacherId('');
    setFormSubjectId('');
    setFormRoom('');
    setFormGroup('');
    setFormDate(format(new Date(), 'yyyy-MM-dd'));
    setFormStartPeriod(selectedSession === 'Tối' ? 11 : 1);
    setFormPeriodCount(3);
    setFormError('');
    setFormNote('');
    setEditItem(null);
    setFormType('class');
    setSelectedSharedClasses([selectedClassId]);
  };

  const getRelatedSharedItems = (sourceItem: ScheduleItem) => {
    const subject = subjects.find(s => s.id === sourceItem.subjectId);
    const isShared = subject?.isShared || (subject && subject.majorId !== 'common' && subject.majorId !== 'culture' && subject.majorId !== 'culture_8');
    
    if (!isShared) return [sourceItem];
    return schedules.filter(s => 
        s.subjectId === sourceItem.subjectId &&
        s.teacherId === sourceItem.teacherId &&
        s.roomId === sourceItem.roomId &&
        s.date === sourceItem.date &&
        s.startPeriod === sourceItem.startPeriod
    );
  };

  const getTeacherForSubject = (subjId: string, clsId: string) => {
    const matches = schedules.filter(s => 
        s.subjectId === subjId && 
        s.classId === clsId && 
        s.type === 'class' &&
        s.status !== ScheduleStatus.OFF
    );
    if (matches.length === 0) return '';
    const latest = matches.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    return latest.teacherId;
  };

  const handleDragStart = (e: React.DragEvent, item: ScheduleItem) => {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); 
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent, targetDate: Date, realTargetPeriod: number) => {
    e.preventDefault();
    if (!draggedItem) return;

    const holiday = getHoliday(targetDate);
    if (holiday) {
        alert(`Không thể xếp lịch vào ngày nghỉ: ${holiday.name}`);
        setDraggedItem(null);
        return;
    }

    const targetDateStr = format(targetDate, 'yyyy-MM-dd');
    if (draggedItem.date === targetDateStr && draggedItem.startPeriod === realTargetPeriod) {
        setDraggedItem(null);
        return;
    }

    const itemsToCopy = getRelatedSharedItems(draggedItem);
    let successCount = 0;

    itemsToCopy.forEach(sourceItem => {
        const newItem = {
            type: sourceItem.type,
            teacherId: sourceItem.teacherId,
            subjectId: sourceItem.subjectId,
            classId: sourceItem.classId,
            roomId: sourceItem.roomId,
            date: targetDateStr,
            session: getSessionFromPeriod(realTargetPeriod),
            startPeriod: realTargetPeriod,
            periodCount: sourceItem.periodCount,
            group: sourceItem.group,
        };

        const conflict = checkConflict(newItem, schedules, subjects, classes); 
        if (!conflict.hasConflict) {
            addSchedule(newItem);
            successCount++;
        }
    });

    if (successCount === 0) {
        alert(`Không thể sao chép (Trùng lịch).`);
    } else if (itemsToCopy.length > 1 && successCount < itemsToCopy.length) {
         alert(`Đã sao chép ${successCount}/${itemsToCopy.length} lớp (Một số lớp bị trùng lịch).`);
    }

    setDraggedItem(null);
  };

  const handleContextMenu = (e: React.MouseEvent, date: Date, period: number, item?: ScheduleItem) => {
    e.preventDefault();
    if (getHoliday(date)) return;
    setContextMenu({
      show: true,
      x: e.pageX,
      y: e.pageY,
      target: { date, period, item }
    });
  };

  const handleCopy = () => {
    if (contextMenu.target?.item) {
      setCopiedItem(contextMenu.target.item);
    }
    setContextMenu({ ...contextMenu, show: false });
  };

  const handlePaste = () => {
    if (!copiedItem || !contextMenu.target) return;

    const holiday = getHoliday(contextMenu.target.date);
    if (holiday) {
        alert(`Không thể dán lịch vào ngày nghỉ: ${holiday.name}`);
        setContextMenu({ ...contextMenu, show: false });
        return;
    }

    const sourceSubject = subjects.find(s => s.id === copiedItem.subjectId);
    if (!sourceSubject) return;

    const sourceItems = getRelatedSharedItems(copiedItem);
    const targetDateStr = format(contextMenu.target.date, 'yyyy-MM-dd');
    const targetPeriod = contextMenu.target.period;
    let pastedCount = 0;

    sourceItems.forEach(src => {
        const newItem = {
            type: src.type,
            teacherId: src.teacherId,
            subjectId: src.subjectId,
            classId: src.classId,
            roomId: src.roomId,
            date: targetDateStr,
            session: getSessionFromPeriod(targetPeriod),
            startPeriod: targetPeriod,
            periodCount: src.periodCount,
            status: ScheduleStatus.PENDING,
            group: src.group,
        };

        const conflict = checkConflict(newItem, schedules, subjects, classes);
        if (!conflict.hasConflict) {
            addSchedule(newItem);
            pastedCount++;
        }
    });

    if (pastedCount === 0) {
        alert("Không thể dán (Trùng lịch).");
    }

    setContextMenu({ ...contextMenu, show: false });
  };

  const handleDeleteItem = () => {
      if (!editItem) return;
      const originalItem = schedules.find(s => s.id === editItem.id);
      if (!originalItem) return;
      const relatedItems = getRelatedSharedItems(originalItem);
      
      if (relatedItems.length > 1) {
          if (!window.confirm(`Đây là môn học chung (Lớp ghép). Xóa buổi học này sẽ xóa lịch của TẤT CẢ ${relatedItems.length} lớp tham gia. Bạn có chắc chắn muốn xóa?`)) {
              return;
          }
      } else {
          if (!window.confirm("Bạn có chắc chắn muốn xóa buổi học này?")) {
              return;
          }
      }
      relatedItems.forEach(item => deleteSchedule(item.id));
      setShowAddModal(false);
  }

  const handleStatusChange = (newStatus: ScheduleStatus) => {
    if (!editItem) return;
    const originalItem = schedules.find(s => s.id === editItem.id);
    if (!originalItem) return;
    const relatedItems = getRelatedSharedItems(originalItem);
    relatedItems.forEach(item => {
        updateSchedule(item.id, { status: newStatus });
    });
    setEditItem({ ...editItem, status: newStatus });
  };

  const handleSaveSchedule = () => {
    const teacherId = editItem ? editItem.teacherId : formTeacherId;
    const subjectId = editItem ? editItem.subjectId : formSubjectId;
    const roomId = editItem ? editItem.roomId : formRoom;
    const group = editItem ? editItem.group : formGroup;
    const classId = editItem ? editItem.classId : selectedClassId;
    const type = editItem ? editItem.type : formType;
    const date = editItem ? editItem.date : formDate;
    const startPeriod = editItem ? editItem.startPeriod : formStartPeriod;
    const periodCount = editItem ? editItem.periodCount : formPeriodCount;
    const note = editItem ? editItem.note : formNote;

    if (!teacherId || !subjectId || !roomId || !classId) {
      setFormError('Vui lòng điền đầy đủ thông tin');
      return;
    }

    const holiday = getHoliday(parseLocal(date));
    if (holiday) {
         setFormError(`Ngày ${format(parseLocal(date), 'dd/MM/yyyy')} là ngày nghỉ: ${holiday.name}`);
         return;
    }

    const baseItem = {
      type,
      teacherId,
      subjectId,
      classId,
      roomId,
      group,
      date,
      session: getSessionFromPeriod(startPeriod),
      startPeriod,
      periodCount,
      note,
    };

    if (editItem) {
        const originalItem = schedules.find(s => s.id === editItem.id);
        if (originalItem) {
            const relatedItems = getRelatedSharedItems(originalItem);
            
            if (relatedItems.length > 1) {
                const isTeacherChanged = editItem.teacherId !== originalItem.teacherId;
                const isRoomChanged = editItem.roomId !== originalItem.roomId;
                const isTimeChanged = editItem.startPeriod !== originalItem.startPeriod || editItem.date !== originalItem.date;

                if (isTeacherChanged || isRoomChanged || isTimeChanged) {
                     const classNames = relatedItems.map(i => classes.find(c => c.id === i.classId)?.name).join(', ');
                     let msg = `Đây là lịch học ghép của ${relatedItems.length} lớp:\n${classNames}\n\n`;
                     if (isTeacherChanged) msg += `- Thay đổi GIÁO VIÊN sẽ áp dụng cho tất cả các lớp.\n`;
                     if (isRoomChanged) msg += `- Thay đổi PHÒNG HỌC sẽ áp dụng cho tất cả các lớp.\n`;
                     if (isTimeChanged) msg += `- Thay đổi THỜI GIAN sẽ áp dụng cho tất cả các lớp.\n`;
                     msg += `\nBạn có chắc chắn muốn cập nhật?`;
                     if (!window.confirm(msg)) return;
                }
            }

            const relatedIds = relatedItems.map(i => i.id);
            for (const item of relatedItems) {
                 const itemToCheck = { ...baseItem, classId: item.classId };
                 const conflict = checkConflict(itemToCheck, schedules, subjects, classes, relatedIds);
                 if (conflict.hasConflict) {
                     const className = classes.find(c => c.id === item.classId)?.name;
                     setFormError(`Lớp ${className}: ${conflict.message}`);
                     return;
                 }
            }
            relatedItems.forEach(item => {
                updateSchedule(item.id, { ...baseItem, classId: item.classId });
            });
        }
    } else {
        const targetClassIds = isFormSubjectShared ? selectedSharedClasses : [classId];
        for (const targetId of targetClassIds) {
            const itemToCheck = { ...baseItem, classId: targetId };
            const conflict = checkConflict(itemToCheck, schedules, subjects, classes);
            if (conflict.hasConflict) {
                 const className = classes.find(c => c.id === targetId)?.name;
                 setFormError(`Lớp ${className}: ${conflict.message}`);
                 return; 
            }
        }
        targetClassIds.forEach(targetId => {
            const newItem = { ...baseItem, classId: targetId };
            addSchedule(newItem);
        });
    }
    setShowAddModal(false);
    resetForm();
  };

  const handleContinueNextWeek = () => {
    const currentWeekSchedules = filteredSchedules.filter(s => {
       const d = parseLocal(s.date);
       return d >= weekStart && d < addDays(weekStart, 7); 
    }).sort((a, b) => {
        const da = parseLocal(a.date).getTime();
        const db = parseLocal(b.date).getTime();
        if (da !== db) return da - db;
        return a.startPeriod - b.startPeriod;
    });

    let addedCount = 0;
    let warnings: string[] = [];
    const addedPeriodsMap: Record<string, number> = {};
    const processedSharedKeys: Set<string> = new Set(); 

    currentWeekSchedules.forEach(item => {
      if (item.type === 'exam') return;
      const subject = subjects.find(s => s.id === item.subjectId);
      if (!subject) return;

      const slotKey = `${item.date}-${item.startPeriod}-${item.teacherId}-${item.subjectId}`;
      let itemsToProcess = [item];

      const isShared = subject.isShared || (subject.majorId !== 'common' && subject.majorId !== 'culture' && subject.majorId !== 'culture_8');

      if (isShared) {
          if (processedSharedKeys.has(slotKey)) return; 
          const sharedGroup = getRelatedSharedItems(item);
          if (sharedGroup.length > 0) {
              itemsToProcess = sharedGroup;
              processedSharedKeys.add(slotKey);
          }
      }

      itemsToProcess.forEach(sourceItem => {
          const key = `${sourceItem.subjectId}-${sourceItem.classId}-${sourceItem.group || 'common'}`;
          const previouslyAdded = addedPeriodsMap[key] || 0;
          
          const itemClass = classes.find(c => c.id === sourceItem.classId);
          const effectiveTotal = getEffectiveTotalPeriods(subject, itemClass);

          const progress = calculateSubjectProgress(sourceItem.subjectId, sourceItem.classId, effectiveTotal, schedules, sourceItem.group);
          const currentRemaining = progress.remaining - previouslyAdded;
          
          if (currentRemaining > 0) {
            const nextDate = addDays(parseLocal(sourceItem.date), 7);
            const newDateStr = format(nextDate, 'yyyy-MM-dd');
            
            const holiday = getHoliday(nextDate);
            if (holiday) {
                const className = classes.find(c => c.id === sourceItem.classId)?.name;
                const msg = `Lớp ${className}: Không thể xếp lịch ngày ${format(nextDate, 'dd/MM/yyyy')} do trùng ngày nghỉ: ${holiday.name}`;
                if (!warnings.includes(msg)) warnings.push(msg);
                return;
            }

            const exists = schedules.some(s => s.classId === sourceItem.classId && s.date === newDateStr && s.startPeriod === sourceItem.startPeriod);

            if (!exists) {
              const periodsToTeach = Math.min(sourceItem.periodCount, currentRemaining);
              const newItem = {
                ...sourceItem,
                date: newDateStr,
                periodCount: periodsToTeach,
                status: ScheduleStatus.PENDING,
                id: generateId() 
              };
              const { id, ...itemWithoutId } = newItem;
              const conflict = checkConflict(itemWithoutId as any, schedules, subjects, classes);
              if (!conflict.hasConflict) {
                addSchedule(itemWithoutId as any);
                addedCount++;
                addedPeriodsMap[key] = previouslyAdded + periodsToTeach;
              }
            }
          }
          
          const finalRemaining = progress.remaining - (addedPeriodsMap[key] || 0);
          const className = classes.find(c => c.id === sourceItem.classId)?.name;
          const groupLabel = sourceItem.group ? `(${sourceItem.group})` : '';

          if (finalRemaining <= 4 && finalRemaining > 0) {
             const msg = `Lớp ${className} ${groupLabel}: Môn ${subject.name} sắp kết thúc (còn ${finalRemaining} tiết)`;
             if (!warnings.includes(msg)) warnings.push(msg);
          }
      });
    });

    if (warnings.length > 0) {
      alert(`Đã sao chép lịch!\n\nCảnh báo:\n${warnings.join('\n')}`);
    } else {
      alert(`Đã sao chép ${addedCount} buổi học sang tuần sau.`);
    }
    handleNextWeek();
  };

  const handleExportExcel = async () => {
    const currentClass = classes.find(c => c.id === selectedClassId);
    if (!currentClass) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Lịch Học');

    const colCount = 2 + gridConfig.columns.length; 
    worksheet.columns = [
      { width: 10 }, { width: 6 }, 
      ...gridConfig.columns.map(() => ({ width: 25 }))
    ];

    const title = `LỊCH HỌC CỦA LỚP ${currentClass.name} TỪ NGÀY ${format(weekStart, 'dd/MM')} ĐẾN NGÀY ${format(addDays(weekStart, 6), 'dd/MM')}`.toUpperCase();
    const titleRow = worksheet.addRow([title]);
    const lastColLetter = String.fromCharCode(64 + colCount);
    worksheet.mergeCells(`A1:${lastColLetter}1`);
    
    titleRow.font = { name: 'Arial', size: 14, bold: true };
    titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.height = 30;

    // Header Row
    const headerLabels = gridConfig.columns.map(col => `${col.label} - ${col.subLabel}`.toUpperCase());
    const headerRow = worksheet.addRow(['Buổi', 'Tiết', ...headerLabels]);
    headerRow.font = { name: 'Arial', size: 10, bold: true };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    headerRow.height = 30;
    
    headerRow.eachCell((cell) => {
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    });

    const borderStyle: Partial<ExcelJS.Borders> = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    const centerStyle: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };

    // Body Rows
    for (const displayPeriod of gridConfig.rows) {
       const row = worksheet.addRow(['', displayPeriod]);
       row.height = 60;
       
       const periodCell = row.getCell(2);
       periodCell.font = { bold: true };
       periodCell.alignment = centerStyle;
       periodCell.border = borderStyle;

       const sessionCell = row.getCell(1);
       sessionCell.border = borderStyle;
    }

    // Merge Session Column based on grid type
    if (gridConfig.type === 'standard') {
        worksheet.mergeCells('A3:A7');
        const morningCell = worksheet.getCell('A3');
        morningCell.value = 'SÁNG';
        morningCell.alignment = { ...centerStyle, textRotation: 90 };
        morningCell.font = { bold: true, size: 12 };
        
        worksheet.mergeCells('A8:A12');
        const afternoonCell = worksheet.getCell('A8');
        afternoonCell.value = 'CHIỀU';
        afternoonCell.alignment = { ...centerStyle, textRotation: 90 };
        afternoonCell.font = { bold: true, size: 12 };
    } else {
        const totalRows = gridConfig.rows.length;
        worksheet.mergeCells(`A3:A${3 + totalRows - 1}`);
        const sessionCell = worksheet.getCell('A3');
        sessionCell.value = 'TỐI';
        sessionCell.alignment = { ...centerStyle, textRotation: 90 };
        sessionCell.font = { bold: true, size: 12 };
    }

    // Data Fill
    for (let colIdx = 0; colIdx < gridConfig.columns.length; colIdx++) {
        const colDef = gridConfig.columns[colIdx];
        const dateStr = format(colDef.date, 'yyyy-MM-dd');
        const excelColIdx = colIdx + 3;
        const holiday = getHoliday(colDef.date);

        for (let rowIdx = 0; rowIdx < gridConfig.rows.length; rowIdx++) {
            const displayPeriod = gridConfig.rows[rowIdx];
            const realPeriod = colDef.periodOffset + displayPeriod;
            
            const rowIndex = rowIdx + 3;
            const cell = worksheet.getCell(rowIndex, excelColIdx);
            cell.border = borderStyle;
            cell.alignment = { vertical: 'middle', wrapText: true, horizontal: 'left' }; 

            if (holiday) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } }; 
                if (rowIdx === 0) { 
                    cell.value = `NGHỈ: ${holiday.name.toUpperCase()}`;
                    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                    cell.font = { bold: true, color: { argb: 'FF888888' } };
                }
                continue;
            }

            const item = filteredSchedules.find(s => s.date === dateStr && s.startPeriod === realPeriod);
            
            if (item) {
                const subj = subjects.find(s => s.id === item.subjectId);
                const tea = teachers.find(t => t.id === item.teacherId);
                
                const effectiveTotal = subj ? getEffectiveTotalPeriods(subj, currentClass) : 0;
                const seqInfo = getSessionSequenceInfo(item, schedules, effectiveTotal);
                const displayCumulative = Math.min(seqInfo.cumulative, effectiveTotal || seqInfo.cumulative);

                const isCulture8 = subj?.majorId === 'culture_8';
                const isSHCN = subj?.name?.trim().toUpperCase() === 'SHCN';

                let cellText = `${subj?.name}`;
                if (item.status === ScheduleStatus.OFF) cellText += ` (NGHỈ)`;
                else if (item.type === 'exam') cellText = `THI: ${subj?.name}`;
                if (item.group) cellText += `\n(${item.group})`; 

                if (isSHCN) {
                } else if (isCulture8) {
                    cellText += `\nGV: ${tea?.name || '---'}`;
                } else {
                    cellText += `\nGV: ${tea?.name || '---'}`;
                    cellText += `\nPhòng: ${item.roomId} | Tiết: ${displayCumulative}/${effectiveTotal}`;
                }
                
                cell.value = cellText;
                cell.font = { name: 'Arial', size: 10, bold: true };

                let argb = 'FFFFFFFF'; 
                if (item.status === ScheduleStatus.OFF) argb = 'FFE0E0E0'; 
                else if (item.type === 'exam') argb = 'FFFFF2CC'; 
                else {
                    if (seqInfo.isFirst) argb = 'FFFCE4D6'; 
                    else if (seqInfo.isLast) argb = 'FFF8CECC'; 
                    else argb = 'FFDDEBF7'; 
                }
                
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } };

                if (item.periodCount > 1) {
                    const endRowIdx = rowIndex + item.periodCount - 1;
                    // Check bounds
                    if (endRowIdx < 3 + gridConfig.rows.length) {
                         worksheet.mergeCells(rowIndex, excelColIdx, endRowIdx, excelColIdx);
                    }
                }
            }
        }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `Lich_Hoc_${currentClass.name}_Tuan_${weekNumber}.xlsx`);
  };

  const handleExportInvitation = (item: any) => {
      const template = templates.find(t => t.type === 'invitation_word');
      if (!template) {
          alert("Vui lòng tải lên mẫu Thư mời giảng (.docx) trong phần 'Hệ thống' trước khi xuất file.");
          return;
      }
      try {
          const teacher = teachers.find(t => t.id === item.teacherId);
          const currentClass = classes.find(c => c.id === item.classId);
          const subject = subjects.find(s => s.id === item.id);

          if (!teacher || !currentClass || !subject) {
              alert("Thiếu thông tin giáo viên, lớp hoặc môn học.");
              return;
          }

          const relevantSchedules = schedules
              .filter(s => s.subjectId === item.id && s.classId === item.classId && s.status !== ScheduleStatus.OFF)
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

          const startDate = relevantSchedules.length > 0 ? format(parseLocal(relevantSchedules[0].date), 'dd/MM/yyyy') : '...';
          const endDate = relevantSchedules.length > 0 ? format(parseLocal(relevantSchedules[relevantSchedules.length - 1].date), 'dd/MM/yyyy') : '...';
          const datesStr = `Từ ngày ${startDate} đến ngày ${endDate}`;

          const sessions = new Set<string>();
          relevantSchedules.forEach(s => {
              if (s.startPeriod <= 5) sessions.add("Sáng (1-5)");
              else if (s.startPeriod <= 10) sessions.add("Chiều (6-10)");
              else sessions.add("Tối (11-14)");
          });
          const sessionStr = Array.from(sessions).join(', ');
          const rooms = Array.from(new Set(relevantSchedules.map(s => s.roomId))).join(', ');

          let location = "Cơ sở 1 - Số 79, ĐT743, phường Bình Hoà, TP. Thuận An, Bình Dương";
          let mapLink = "https://maps.app.goo.gl/Y9ubh6zCUp6USaun8";
          const nameToCheck = currentClass.name.trim();
          if (nameToCheck.endsWith('2') || nameToCheck.endsWith('(2)') || nameToCheck.toLowerCase().includes('cơ sở 2')) {
             location = "Cơ sở 2 - Số 470, tổ 3, Ba Đình, phường Tân Đông Hiệp, TP. Dĩ An, Bình Dương";
             mapLink = "https://maps.app.goo.gl/8Vwf8gMnPuMGpNgA8";
          }
          const rateStr = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(teacher.ratePerPeriod || 0);

          const effectiveTotal = getEffectiveTotalPeriods(subject, currentClass);

          const data = {
              teacherTitle: teacher.title || 'Thầy/Cô',
              teacherName: teacher.name,
              subjectName: subject.name,
              className: currentClass.name,
              totalPeriods: effectiveTotal,
              dates: datesStr,
              sessions: sessionStr,
              rate: rateStr,
              room: rooms,
              location: location,
              mapLink: mapLink
          };

          const zip = new PizZip(base64ToArrayBuffer(template.content));
          const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
          doc.render(data);
          const out = doc.getZip().generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
          saveAs(out, `Thu_Moi_Giang_${teacher.name}_${subject.name}.docx`);
      } catch (error) {
          console.error(error);
          alert("Lỗi khi tạo file thư mời: " + error);
      }
  };

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
           {/* Session Filter */}
           <div className="flex items-center gap-2">
              {selectedSession === 'Ban ngày' ? <Sun className="text-orange-500" size={20} /> : <Moon className="text-blue-500" size={20} />}
              <select 
                  className="border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-semibold text-gray-700 bg-gray-50"
                  value={selectedSession}
                  onChange={(e) => {
                      const newSession = e.target.value;
                      setSelectedSession(newSession);
                      const firstClass = classes.find(c => (c.session || 'Ban ngày') === newSession);
                      if (firstClass) setSelectedClassId(firstClass.id);
                      else setSelectedClassId('');
                  }}
              >
                  <option value="Ban ngày">Buổi: Ban ngày</option>
                  <option value="Tối">Buổi: Tối</option>
              </select>
           </div>

           {/* Class Filter */}
           <div className="flex items-center gap-2">
               <ListFilter size={20} className="text-gray-500" />
               <select 
                 className="border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none min-w-[200px]"
                 value={selectedClassId}
                 onChange={(e) => setSelectedClassId(e.target.value)}
               >
                 {filteredClassList.length === 0 && <option value="">-- Không có lớp --</option>}
                 {filteredClassList.map(c => <option key={c.id} value={c.id}>{c.name} ({c.studentCount} SV)</option>)}
               </select>
           </div>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={handlePrevWeek} className="p-2 hover:bg-gray-100 rounded-full"><ChevronLeft /></button>
          <div className="text-center">
            <p className="font-bold text-lg">Tuần {weekNumber}</p>
            <p className="text-xs text-gray-500">
                {format(weekStart, 'dd/MM')} - {format(addDays(weekStart, 6), 'dd/MM/yyyy')}
            </p>
          </div>
          <button onClick={handleNextWeek} className="p-2 hover:bg-gray-100 rounded-full"><ChevronRight /></button>
        </div>

        <div className="flex gap-2">
            <button 
                onClick={handleContinueNextWeek}
                className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm font-medium"
            >
                <CalendarIcon size={16} /> Tiếp tục lịch tuần sau
            </button>
            <button 
                onClick={handleExportExcel}
                className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
            >
                <Download size={16} /> Xuất file lịch học
            </button>
            <button 
                onClick={() => { resetForm(); setShowAddModal(true); }}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
            >
                <Plus size={16} /> Thêm lịch
            </button>
        </div>
      </div>

      {/* Timetable Grid */}
      <div className="bg-white rounded-xl shadow overflow-x-auto relative">
        <table className="w-full min-w-[1000px] border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-700 text-sm uppercase">
              <th className="border p-2 w-16">Buổi</th>
              <th className="border p-2 w-12">Tiết</th>
              {/* Dynamic Headers based on Grid Columns */}
              {gridConfig.columns.map((col, idx) => (
                <th key={idx} className="border p-2 min-w-[140px]">
                  <div className={`text-center ${isSameDay(col.date, new Date()) ? 'text-blue-600 font-bold' : ''}`}>
                    <div>{col.label}</div>
                    <div className="text-xs font-normal text-gray-500">{col.subLabel}</div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-sm">
             {gridConfig.rows.map((displayPeriod, index) => {
               // Logic for Session Label (Sáng/Chiều/Tối)
               let isStartOfSession = false;
               let sessionRowSpan = 0;
               let sessionLabel = '';

               if (gridConfig.type === 'standard') {
                   // Standard: 1-10 absolute
                   if (displayPeriod === 1) { 
                       isStartOfSession = true; 
                       sessionRowSpan = 5; 
                       sessionLabel = 'Sáng';
                   } else if (displayPeriod === 6) { 
                       isStartOfSession = true; 
                       sessionRowSpan = 5; 
                       sessionLabel = 'Chiều';
                   }
               } else {
                   // Matrix (Evening): 1-4 relative
                   if (index === 0) {
                       isStartOfSession = true;
                       sessionRowSpan = 4;
                       sessionLabel = 'Tối'; // Label for the row block
                   }
               }
               
               return (
                 <tr key={displayPeriod} className="hover:bg-gray-50">
                   {isStartOfSession && (
                     <td rowSpan={sessionRowSpan} className="border p-2 text-center font-bold bg-gray-50 writing-mode-vertical">
                       {sessionLabel}
                     </td>
                   )}
                   <td className="border p-2 text-center font-semibold text-gray-500">{displayPeriod}</td>
                   
                   {/* Iterate Grid Columns */}
                   {gridConfig.columns.map((col, colIdx) => {
                     const dateStr = format(col.date, 'yyyy-MM-dd');
                     const holiday = getHoliday(col.date);
                     
                     // Calculate REAL Period from (Display Period + Base Offset)
                     const realStartPeriod = col.periodOffset + displayPeriod;

                     // RENDER HOLIDAY
                     if (holiday) {
                         if (index === 0) { // Only render content in first cell, but block all
                            return (
                                <td key={`${colIdx}-holiday`} rowSpan={gridConfig.rows.length} className="border p-1 bg-gray-200 cursor-not-allowed text-center align-middle opacity-80">
                                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                        <CalendarOff size={32} className="mb-2" />
                                        <span className="font-bold text-lg block">{holiday.name.toUpperCase()}</span>
                                    </div>
                                </td>
                            );
                         }
                         return null; // Skip subsequent periods for this column
                     }

                     const item = filteredSchedules.find(s => s.date === dateStr && s.startPeriod === realStartPeriod);
                     const coveringItem = filteredSchedules.find(s => s.date === dateStr && s.startPeriod < realStartPeriod && (s.startPeriod + s.periodCount) > realStartPeriod);

                     if (coveringItem) return null;

                     if (!item) {
                       return (
                         <td 
                            key={`${colIdx}-${displayPeriod}`} 
                            className="border p-1 hover:bg-gray-100 transition-colors cursor-pointer"
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, col.date, realStartPeriod)}
                            onContextMenu={(e) => handleContextMenu(e, col.date, realStartPeriod)}
                            onDoubleClick={() => { 
                                resetForm(); 
                                setFormDate(format(col.date, 'yyyy-MM-dd')); 
                                setFormStartPeriod(realStartPeriod); 
                                setShowAddModal(true); 
                            }}
                         />
                       );
                     }

                     const subject = subjects.find(s => s.id === item.subjectId);
                     const teacher = teachers.find(t => t.id === item.teacherId);
                     
                     const effectiveTotal = subject ? getEffectiveTotalPeriods(subject, currentClass) : 0;
                     const seqInfo = getSessionSequenceInfo(item, schedules, effectiveTotal);
                     const displayCumulative = Math.min(seqInfo.cumulative, effectiveTotal || seqInfo.cumulative);
                     const computedStatus = determineStatus(item.date, item.startPeriod, item.status);

                     let bgColor = 'bg-blue-50 border-l-4 border-blue-500';
                     if (item.type === 'class') {
                        if (seqInfo.isFirst) bgColor = 'bg-orange-100 border-l-4 border-orange-500';
                        else if (seqInfo.isLast) bgColor = 'bg-red-100 border-l-4 border-red-500';
                     }
                     if (item.type === 'exam') bgColor = 'bg-yellow-50 border-l-4 border-yellow-500';
                     if (computedStatus === ScheduleStatus.OFF) bgColor = 'bg-gray-200 border-l-4 border-gray-500 opacity-70';
                     if (computedStatus === ScheduleStatus.MAKEUP) bgColor = 'bg-purple-50 border-l-4 border-purple-500';

                     return (
                       <td 
                         key={`${colIdx}-${displayPeriod}`} 
                         rowSpan={item.periodCount} 
                         className="border p-1 align-top relative group cursor-pointer hover:brightness-95 transition" 
                         onDoubleClick={() => { setEditItem(item); setShowAddModal(true); }}
                         draggable="true"
                         onDragStart={(e) => handleDragStart(e, item)}
                         onContextMenu={(e) => handleContextMenu(e, col.date, realStartPeriod, item)}
                       >
                         <div className={`h-full w-full p-2 rounded text-xs ${bgColor} flex flex-col justify-between ${draggedItem?.id === item.id ? 'opacity-50' : ''}`}>
                           <div>
                             <div className="font-bold text-gray-800 text-sm mb-1">
                                {subject?.name}
                                {item.group && <span className="ml-1 text-red-600 font-normal">({item.group})</span>}
                             </div>
                             <div className="text-gray-600 mb-0.5"><span className="font-semibold">GV:</span> {teacher?.name || '---'}</div>
                             <div className="text-gray-600 mb-0.5"><span className="font-semibold">Phòng:</span> {item.roomId}</div>
                             {item.type === 'class' && (
                                <div className="text-gray-500 italic">Tiến độ: {displayCumulative}/{effectiveTotal}</div>
                             )}
                           </div>
                           <div className="mt-2 pt-2 border-t border-black/10 flex justify-between items-center">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase text-white 
                                ${computedStatus === ScheduleStatus.COMPLETED ? 'bg-green-500' : 
                                  computedStatus === ScheduleStatus.PENDING ? 'bg-blue-400' :
                                  computedStatus === ScheduleStatus.ONGOING ? 'bg-orange-500' :
                                  computedStatus === ScheduleStatus.OFF ? 'bg-gray-500' : 'bg-purple-500'
                                }`}>
                                {computedStatus}
                              </span>
                           </div>
                         </div>
                       </td>
                     );
                   })}
                 </tr>
               );
             })}
          </tbody>
        </table>
      </div>

      {/* Active Subjects Summary & Invitation */}
      <div className="bg-white rounded-xl shadow border border-gray-200 p-6">
         <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
            <BookOpen className="mr-2 text-blue-600" /> Môn học đang triển khai
         </h2>
         <div className="overflow-x-auto">
             <table className="w-full text-left text-sm">
                 <thead className="bg-gray-50 border-b">
                     <tr>
                         <th className="p-3 w-12 text-center">STT</th>
                         <th className="p-3">Tên môn học</th>
                         <th className="p-3">Tên giáo viên</th>
                         <th className="p-3">Số tiết</th>
                         <th className="p-3">Lớp</th>
                         <th className="p-3 text-center">Thư mời giảng</th>
                     </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-100">
                     {activeSubjectsSummary.length === 0 ? (
                         <tr>
                             <td colSpan={6} className="p-6 text-center text-gray-400 italic">
                                 Chưa có môn học nào được xếp lịch {weekNumber ? `trong tuần ${weekNumber}` : ''}.
                             </td>
                         </tr>
                     ) : (
                         activeSubjectsSummary.map((item, index) => (
                             <tr key={item.id} className="hover:bg-gray-50">
                                 <td className="p-3 text-center text-gray-500">{index + 1}</td>
                                 <td className="p-3 font-medium text-gray-800">{item.subjectName}</td>
                                 <td className="p-3 text-gray-600">{item.teacherName}</td>
                                 <td className="p-3 text-gray-600">{item.totalPeriods}</td>
                                 <td className="p-3 text-gray-600">{item.className}</td>
                                 <td className="p-3 text-center">
                                     <button 
                                        onClick={() => handleExportInvitation(item)}
                                        className="inline-flex items-center px-3 py-1.5 bg-white border border-blue-200 text-blue-600 rounded hover:bg-blue-50 transition-colors shadow-sm text-xs font-medium"
                                     >
                                         <Mail size={14} className="mr-1.5" /> Xuất thư mời
                                     </button>
                                 </td>
                             </tr>
                         ))
                     )}
                 </tbody>
             </table>
         </div>
      </div>

      {/* Context Menu */}
      {contextMenu.show && (
        <div 
            className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-48 animate-in fade-in zoom-in-95 duration-100"
            style={{ top: contextMenu.y, left: contextMenu.x }}
        >
            {contextMenu.target?.item ? (
                <button 
                    onClick={handleCopy}
                    className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center text-sm text-gray-700"
                >
                    <Copy size={16} className="mr-2" /> Sao chép buổi học
                </button>
            ) : (
                <button 
                    onClick={handlePaste}
                    disabled={!copiedItem}
                    className={`w-full text-left px-4 py-2 flex items-center text-sm ${
                        copiedItem 
                        ? 'hover:bg-gray-100 text-gray-700' 
                        : 'text-gray-400 cursor-not-allowed'
                    }`}
                >
                    <Clipboard size={16} className="mr-2" /> Dán vào ô này
                </button>
            )}
            
            {copiedItem && contextMenu.target?.item === undefined && (
                <div className="px-4 py-1 text-xs text-gray-400 border-t mt-1">
                   Đã sao chép 1 buổi.
                </div>
            )}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50 shrink-0">
              <h3 className="font-bold text-lg">{editItem ? 'Điều chỉnh lịch' : 'Thêm lịch mới'}</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-500 hover:text-red-500"><X /></button>
            </div>
            
            <div className="p-6 space-y-4 overflow-y-auto">
              {formError && (
                 <div className="bg-red-50 text-red-600 p-3 rounded flex items-center text-sm">
                   <AlertCircle size={16} className="mr-2" /> {formError}
                 </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Loại lịch</label>
                    <select 
                        value={editItem ? editItem.type : formType} 
                        onChange={(e) => {
                            if (!editItem) {
                                const val = e.target.value as 'class' | 'exam';
                                setFormType(val);
                                // Auto-select teacher if exam and subject is already selected
                                if (val === 'exam' && formSubjectId) {
                                    const suggested = getTeacherForSubject(formSubjectId, selectedClassId);
                                    if (suggested) setFormTeacherId(suggested);
                                }
                            }
                        }} 
                        disabled={!!editItem} 
                        className="w-full border rounded p-2"
                    >
                        <option value="class">Lịch học</option>
                        <option value="exam">Lịch thi</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Lớp chính</label>
                    <input type="text" value={classes.find(c => c.id === selectedClassId)?.name} disabled className="w-full border rounded p-2 bg-gray-100" />
                  </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-sm font-medium mb-1">Ngày dạy</label>
                    <input type="date" value={editItem ? editItem.date : formDate} onChange={(e) => editItem ? setEditItem({...editItem, date: e.target.value}) : setFormDate(e.target.value)} className="w-full border rounded p-2" />
                 </div>
                 <div>
                    <label className="block text-sm font-medium mb-1">Giáo viên</label>
                    <select 
                        value={editItem ? editItem.teacherId : formTeacherId} 
                        onChange={(e) => editItem ? setEditItem({...editItem, teacherId: e.target.value}) : setFormTeacherId(e.target.value)} 
                        className="w-full border rounded p-2"
                    >
                        <option value="">Chọn giáo viên...</option>
                        {suggestedTeachers.length > 0 && (
                            <optgroup label="Giáo viên phụ trách">
                                {suggestedTeachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </optgroup>
                        )}
                        <optgroup label={suggestedTeachers.length > 0 ? "Giáo viên khác" : "Danh sách giáo viên"}>
                            {otherTeachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </optgroup>
                    </select>
                 </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Môn học</label>
                <select 
                    value={editItem ? editItem.subjectId : formSubjectId} 
                    onChange={(e) => {
                        const val = e.target.value;
                        const clsId = editItem ? editItem.classId : selectedClassId;
                        const isExam = editItem ? editItem.type === 'exam' : formType === 'exam';
                        
                        // Auto-detect teacher
                        let autoTeacherId = '';
                        const selectedSub = subjects.find(s => s.id === val);
                        
                        if (selectedSub) {
                             const t1 = teachers.find(t => t.name.toLowerCase().trim() === selectedSub.teacher1?.toLowerCase().trim());
                             if (t1) autoTeacherId = t1.id;
                             else {
                                 const t2 = teachers.find(t => t.name.toLowerCase().trim() === selectedSub.teacher2?.toLowerCase().trim());
                                 if (t2) autoTeacherId = t2.id;
                             }
                        }
                        
                        if (isExam && val) {
                            const historyTeacher = getTeacherForSubject(val, clsId);
                            if (historyTeacher) autoTeacherId = historyTeacher;
                        }

                        // NEW: Calculate remaining periods to auto-adjust for the last session
                        // Skip if Culture 8 (allow unlimited scheduling)
                        if (val && !isExam && selectedSub?.majorId !== 'culture_8') {
                            if (selectedSub) {
                                const used = schedules.filter(s =>
                                    s.subjectId === val &&
                                    s.classId === selectedClassId &&
                                    s.status !== ScheduleStatus.OFF &&
                                    (editItem ? s.id !== editItem.id : true)
                                ).reduce((acc, curr) => acc + curr.periodCount, 0);

                                // Use effective total
                                const effectiveTotal = getEffectiveTotalPeriods(selectedSub, currentClass);

                                const remaining = Math.max(0, effectiveTotal - used);
                                
                                // Calculate max periods allowed based on start period (morning/afternoon/evening boundary)
                                const currentStart = editItem ? editItem.startPeriod : formStartPeriod;
                                let maxSession = 3;
                                if (currentStart <= 5) maxSession = 6 - currentStart;
                                else if (currentStart <= 10) maxSession = 11 - currentStart;
                                else maxSession = 15 - currentStart; // Evening up to 14

                                let suggested = 3; // Default batch
                                if (remaining < suggested) suggested = remaining; // Last session case
                                
                                suggested = Math.min(suggested, maxSession);
                                if (remaining > 0) suggested = Math.max(1, suggested);
                                
                                if (editItem) {
                                    setEditItem(prev => prev ? ({ ...prev, subjectId: val, teacherId: autoTeacherId, periodCount: suggested }) : null);
                                } else {
                                    setFormSubjectId(val);
                                    setFormTeacherId(autoTeacherId);
                                    setFormPeriodCount(suggested);
                                }
                                return;
                            }
                        }
                
                        if (editItem) {
                            setEditItem({ ...editItem, subjectId: val, teacherId: autoTeacherId });
                        } else {
                            setFormSubjectId(val);
                            setFormTeacherId(autoTeacherId);
                        }
                    }} 
                    className="w-full border rounded p-2"
                >
                    <option value="">Chọn môn học...</option>
                    {availableSubjects.map(s => {
                        const effectiveTotal = getEffectiveTotalPeriods(s, currentClass);
                        return <option key={s.id} value={s.id}>{s.name} ({effectiveTotal} tiết)</option>
                    })}
                </select>
              </div>

              {/* NEW: Multi-Select for Shared Subjects */}
              {isFormSubjectShared && !editItem && (
                  <div className="bg-blue-50 p-3 rounded border border-blue-200">
                    <label className="block text-sm font-bold mb-2 text-blue-800 flex items-center">
                        <Users size={16} className="mr-2"/> Chọn các lớp học ghép (Môn chung)
                    </label>
                    <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                        {classes.filter(cls => {
                            if (!currentFormSubject) return false;

                            const mainClass = classes.find(c => c.id === selectedClassId);
                            if (!mainClass) return false;

                            // NEW: Campus Logic - Filter out classes from different campuses
                            const mainCampus = mainClass.campus || 'Cơ sở 1';
                            const candidateCampus = cls.campus || 'Cơ sở 1';
                            if (mainCampus !== candidateCampus) {
                                return false;
                            }

                            // NEW: Session Logic - Filter out classes from different sessions
                            const mainSession = mainClass.session || 'Ban ngày';
                            const candidateSession = cls.session || 'Ban ngày';
                            if (mainSession !== candidateSession) {
                                return false;
                            }

                            // 1. Culture: Exclude H8
                            if (currentFormSubject.majorId === 'culture') {
                                return !cls.name.toUpperCase().includes('H8');
                            }

                             // 2. Culture 8: Only H8
                            if (currentFormSubject.majorId === 'culture_8') {
                                return cls.name.toUpperCase().includes('H8');
                            }
                            
                            // 3. Common: Include All (that match campus/session)
                            if (currentFormSubject.majorId === 'common') {
                                return true;
                            }

                            // 4. Specific Major: Only include classes with same major
                            return cls.majorId === currentFormSubject.majorId;
                        }).map(cls => (
                            <label key={cls.id} className={`flex items-center space-x-2 text-sm p-2 rounded cursor-pointer ${selectedSharedClasses.includes(cls.id) ? 'bg-blue-100' : 'hover:bg-white'}`}>
                                <input
                                    type="checkbox"
                                    className="rounded text-blue-600 focus:ring-blue-500"
                                    checked={selectedSharedClasses.includes(cls.id)}
                                    disabled={cls.id === selectedClassId} // Current class is mandatory
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedSharedClasses([...selectedSharedClasses, cls.id]);
                                        } else {
                                            setSelectedSharedClasses(selectedSharedClasses.filter(id => id !== cls.id));
                                        }
                                    }}
                                />
                                <span className={cls.id === selectedClassId ? 'font-bold' : ''}>{cls.name}</span>
                            </label>
                        ))}
                    </div>
                  </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Tiết bắt đầu</label>
                    <select 
                        value={editItem ? editItem.startPeriod : formStartPeriod} 
                        onChange={(e) => {
                            const val = Number(e.target.value);
                            let maxSession = 3;
                            if (val <= 5) maxSession = 6 - val;
                            else if (val <= 10) maxSession = 11 - val;
                            else maxSession = 15 - val;
                            
                            if (editItem) {
                                // Adjust count if it exceeds new max
                                const newCount = Math.min(editItem.periodCount, maxSession);
                                setEditItem({...editItem, startPeriod: val, periodCount: newCount});
                            } else {
                                const newCount = Math.min(formPeriodCount, maxSession);
                                setFormStartPeriod(val);
                                setFormPeriodCount(newCount);
                            }
                        }} 
                        className="w-full border rounded p-2"
                    >
                        {/* Always show 1-14 in dropdown for manual selection flexibility, even if grid is relative */}
                        {Array.from({length: 14}, (_, i) => i + 1).map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                   <div>
                    <label className="block text-sm font-medium mb-1">Số tiết</label>
                    <input 
                        type="number" 
                        min="1" 
                        max={(() => {
                            const start = editItem ? editItem.startPeriod : formStartPeriod;
                            if (start <= 5) return 6 - start;
                            if (start <= 10) return 11 - start;
                            return 15 - start;
                        })()}
                        value={editItem ? editItem.periodCount : formPeriodCount} 
                        onChange={(e) => {
                            let val = Number(e.target.value);
                            const start = editItem ? editItem.startPeriod : formStartPeriod;
                            let maxSession = 3;
                            if (start <= 5) maxSession = 6 - start;
                            else if (start <= 10) maxSession = 11 - start;
                            else maxSession = 15 - start;
                            
                            if (val > maxSession) val = maxSession;

                            const subjId = editItem ? editItem.subjectId : formSubjectId;
                            const type = editItem ? editItem.type : formType;

                            if (type === 'class' && subjId) {
                                const subject = subjects.find(s => s.id === subjId);
                                // Skip limiting for culture_8
                                if (subject && subject.majorId !== 'culture_8') {
                                    const used = schedules.filter(s =>
                                        s.subjectId === subjId &&
                                        s.classId === selectedClassId &&
                                        s.status !== ScheduleStatus.OFF &&
                                        (editItem ? s.id !== editItem.id : true)
                                    ).reduce((acc, curr) => acc + curr.periodCount, 0);

                                    // Use effective total
                                    const effectiveTotal = getEffectiveTotalPeriods(subject, currentClass);

                                    const remaining = Math.max(0, effectiveTotal - used);
                                    if (val > remaining) {
                                        alert(`Môn học chỉ còn ${remaining} tiết`);
                                        val = remaining;
                                    }
                                }
                            }

                            if (editItem) setEditItem({...editItem, periodCount: val});
                            else setFormPeriodCount(val);
                        }} 
                        className="w-full border rounded p-2" 
                    />
                  </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Phòng học</label>
                    <input type="text" value={editItem ? editItem.roomId : formRoom} onChange={(e) => editItem ? setEditItem({...editItem, roomId: e.target.value}) : setFormRoom(e.target.value)} className="w-full border rounded p-2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Nhóm (Thực hành)</label>
                    <select 
                        value={editItem ? (editItem.group || '') : formGroup} 
                        onChange={(e) => editItem ? setEditItem({...editItem, group: e.target.value}) : setFormGroup(e.target.value)} 
                        className="w-full border rounded p-2"
                    >
                        <option value="">-- Cả lớp --</option>
                        <option value="Nhóm 1">Nhóm 1</option>
                        <option value="Nhóm 2">Nhóm 2</option>
                        <option value="Nhóm 3">Nhóm 3</option>
                    </select>
                  </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Ghi chú</label>
                <input 
                    type="text" 
                    value={editItem ? (editItem.note || '') : formNote} 
                    onChange={(e) => editItem ? setEditItem({...editItem, note: e.target.value}) : setFormNote(e.target.value)} 
                    placeholder="Ví dụ: Thi thực hành, ..." 
                    className="w-full border rounded p-2" 
                />
              </div>

              {editItem && (
                  <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                      <label className="block text-sm font-bold mb-2 text-yellow-800">Trạng thái & Điều chỉnh</label>
                      <div className="flex flex-wrap gap-2">
                          {Object.values(ScheduleStatus).map(status => (
                              <button 
                                key={status}
                                onClick={() => handleStatusChange(status)}
                                className={`px-2 py-1 rounded text-xs border ${editItem.status === status ? 'bg-yellow-500 text-white border-yellow-600' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
                              >
                                  {status}
                              </button>
                          ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                          *Chọn "Nghỉ" để đánh dấu buổi nghỉ. Chọn "Tiết bổ sung" cho lịch bù.
                      </p>
                  </div>
              )}
            </div>

            <div className="p-4 border-t bg-gray-50 flex justify-between shrink-0">
              {editItem ? (
                 <button onClick={handleDeleteItem} className="text-red-600 hover:bg-red-50 px-3 py-2 rounded flex items-center">
                    <Trash2 size={16} className="mr-1" /> Xóa
                 </button>
              ) : <div></div>}
              
              <div className="flex gap-2">
                  <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded">Hủy</button>
                  <button onClick={handleSaveSchedule} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center">
                    <Save size={16} className="mr-2" /> Lưu
                  </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleManager;
