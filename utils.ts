
import { ScheduleItem, ScheduleStatus, Subject, ClassEntity } from './types';
import { isSameDay } from 'date-fns';

export const generateId = () => {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
};

export const getSessionFromPeriod = (startPeriod: number): 'Sáng' | 'Chiều' | 'Tối' => {
  if (startPeriod <= 5) return 'Sáng';
  if (startPeriod <= 10) return 'Chiều';
  return 'Tối';
};

// NEW: Helper to get effective total periods based on class session (Evening vs Day)
export const getEffectiveTotalPeriods = (subject: Subject, classEntity?: ClassEntity): number => {
    if (classEntity?.session === 'Tối' && subject.totalPeriodsEvening && subject.totalPeriodsEvening > 0) {
        return subject.totalPeriodsEvening;
    }
    return subject.totalPeriods;
};

// Helper for parsing YYYY-MM-DD to Local Date
export const parseLocal = (dateStr: string): Date => {
  if (!dateStr) return new Date();
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date();
  const [y, m, d] = parts.map(Number);
  return new Date(y, m - 1, d);
};

// Helper: Base64 string to ArrayBuffer (For Docxtemplater & ExcelJS)
// Updated to handle both Data URI strings and raw Base64 strings safely
export const base64ToArrayBuffer = (base64: string) => {
    // Check if string has Data URI prefix (e.g., "data:application/vnd...;base64,")
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    
    // Safety check for clean string
    const cleanBase64 = base64Data.trim();
    
    const binaryString = window.atob(cleanBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// Helper to determine Campus ID based on Class Name
// 1: Campus 1, 2: Campus 2, 0: Unknown/Any
export const getCampusId = (className: string): number => {
    if (!className) return 0;
    const name = className.trim().toUpperCase();

    // Case 1: Starts with 24... ends with 01 (CS1) or 02 (CS2)
    if (name.startsWith('24')) {
        if (name.endsWith('01')) return 1;
        if (name.endsWith('02')) return 2;
    }

    // Case 2: Starts with 25 or higher... contains 1 (CS1) or 2 (CS2) in the body
    const prefixMatch = name.match(/^(\d{2})/);
    if (prefixMatch) {
        const year = parseInt(prefixMatch[1]);
        if (year >= 25) {
            // Remove the year prefix to avoid false positive on '2' in '25'
            // Although '25' contains '2', splitting ensures we look at the rest
            const body = name.substring(2); 
            if (body.includes('1')) return 1;
            if (body.includes('2')) return 2;
        }
    }

    return 0;
};

// Conflict Checker
export const checkConflict = (
  newItem: Omit<ScheduleItem, 'id' | 'status'>,
  existingItems: ScheduleItem[],
  subjects: Subject[], // NEW: Pass subjects list to check for isShared
  classes: ClassEntity[], // NEW: Pass classes to check for Campus rooms
  excludeIds?: string | string[] // Modified to support array
): { hasConflict: boolean; message: string } => {
  const newItemEnd = newItem.startPeriod + newItem.periodCount;
  
  // Find current subject details
  const currentSubject = subjects.find(s => s.id === newItem.subjectId);
  const isNewItemShared = !!currentSubject?.isShared;

  const excluded = Array.isArray(excludeIds) ? excludeIds : (excludeIds ? [excludeIds] : []);

  for (const item of existingItems) {
    if (excluded.includes(item.id)) continue;
    if (item.status === ScheduleStatus.OFF) continue; // Ignored cancelled classes

    if (isSameDay(parseLocal(item.date), parseLocal(newItem.date))) {
      const itemEnd = item.startPeriod + item.periodCount;
      
      // Check time overlap
      // (StartA < EndB) and (EndA > StartB)
      const overlap = (newItem.startPeriod < itemEnd) && (newItemEnd > item.startPeriod);

      if (overlap) {
        // 1. Absolute rule: Cannot schedule the EXACT SAME subject for the EXACT SAME class at the same time.
        // This prevents accidental double-entries, which is likely a mistake even for shared subjects.
        if (item.classId === newItem.classId && item.subjectId === newItem.subjectId) {
             return { hasConflict: true, message: `Lớp này đã có lịch môn này vào giờ này rồi.` };
        }

        // Shared Subject Logic:
        // If the subject is marked as 'Shared', we ignore other conflict rules ONLY IF
        // the existing item is ALSO the same shared subject instance (Same Subject, Same Teacher, Same Room).
        if (isNewItemShared) {
            const isSameSharedInstance = 
                item.subjectId === newItem.subjectId &&
                item.teacherId === newItem.teacherId &&
                item.roomId === newItem.roomId;

            if (isSameSharedInstance) {
                // This is a sibling class in the same shared session. Allow overlap.
                continue; 
            }
            // If it's a shared subject but different teacher/room, fall through to standard checks.
        }

        const conflictClassName = classes.find(c => c.id === item.classId)?.name || 'Lớp không xác định';

        // Standard Checks for Normal Subjects (or non-matching Shared Subjects)
        if (item.roomId === newItem.roomId) {
             // Check Campus Logic: If classes are in different campuses, same room name is allowed.
             const classA = classes.find(c => c.id === item.classId);
             const classB = classes.find(c => c.id === newItem.classId);
             const campusA = getCampusId(classA?.name || '');
             const campusB = getCampusId(classB?.name || '');

             // If both have specific campuses and they are different, allow same room name
             if (campusA !== 0 && campusB !== 0 && campusA !== campusB) {
                 // No conflict (Different physical locations)
             } else {
                 return { hasConflict: true, message: `Trùng phòng học ${item.roomId}: Đang có lớp ${conflictClassName} học.` };
             }
        }
        
        if (item.teacherId === newItem.teacherId) {
             // UPDATE: If either item is an EXAM, ignore teacher conflict.
             // Teacher name on exam schedule is informational (Responsible Teacher), not necessarily blocking availability.
             const isItemExam = item.type === 'exam';
             const isNewItemExam = newItem.type === 'exam';

             if (!isItemExam && !isNewItemExam) {
                 return { hasConflict: true, message: `Trùng giáo viên: GV này đang dạy lớp ${conflictClassName}.` };
             }
        }
        if (item.classId === newItem.classId) {
             return { hasConflict: true, message: `Trùng lịch học của lớp: Lớp này đang học môn khác.` };
        }
        
        // Specific check for exams vs class
        if (item.type === 'exam' && newItem.type === 'class' && item.classId === newItem.classId) {
             return { hasConflict: true, message: `Lớp có lịch thi vào giờ này.` };
        }
        if (item.type === 'class' && newItem.type === 'exam' && item.classId === newItem.classId) {
             return { hasConflict: true, message: `Lớp có lịch học vào giờ này.` };
        }

        // Shared Class Conflict Detection: If this is a shared class move, check if any of the classes in the shared group are already busy
        if (isNewItemShared && item.classId !== newItem.classId) {
             // This logic is already partially covered by the standard classId check, 
             // but we want to ensure that if we are moving a group of classes (A, B) to a slot,
             // and class B is already busy with another subject X, we catch it.
             // The checkConflict is usually called per classId in the loop, so it should naturally catch it.
             // However, let's make the message more specific if it's a shared subject conflict.
             return { hasConflict: true, message: `Lớp ${conflictClassName} đang bận học môn khác (${item.subjectId === newItem.subjectId ? 'Cùng môn' : 'Môn khác'}) tại phòng ${item.roomId}.` };
        }
      }
    }
  }

  return { hasConflict: false, message: '' };
};

export const calculateSubjectProgress = (
  subjectId: string, 
  classId: string, 
  totalPeriods: number, 
  schedules: ScheduleItem[],
  group?: string // NEW: Optional group filter
) => {
  const learned = schedules
    .filter(s => {
        if (s.subjectId !== subjectId || s.classId !== classId || s.status === ScheduleStatus.OFF) return false;
        
        // Logic:
        // If checking progress for a specific group (e.g., "Group 1"):
        // Count items that are "Shared/Common" (no group) OR items belonging to "Group 1".
        // Do NOT count items belonging to "Group 2".
        if (group) {
            return !s.group || s.group === group;
        }

        // If checking general progress (no group specified, e.g. Theory or Dashboard overview):
        // Only count Shared/Common items.
        // NOTE: If this is too strict for dashboard, we might need a different flag.
        // But for "Continuing Schedule", this is correct: Theory continues Theory.
        return !s.group;
    })
    .reduce((acc, curr) => acc + curr.periodCount, 0);
  
  return {
    learned,
    total: totalPeriods,
    percentage: Math.min(100, Math.round((learned / totalPeriods) * 100)),
    remaining: Math.max(0, totalPeriods - learned)
  };
};

// NEW: Helper to get sequence info (cumulative progress, isFirst, isLast)
export const getSessionSequenceInfo = (
  currentItem: ScheduleItem,
  allSchedules: ScheduleItem[],
  totalPeriods: number = 0
) => {
  // 1. Get all valid sessions for this subject & class
  const relevantItems = allSchedules.filter(s => 
    s.subjectId === currentItem.subjectId && 
    s.classId === currentItem.classId && 
    s.status !== ScheduleStatus.OFF &&
    s.type === 'class' &&
    // Logic: 
    // If currentItem has a group (e.g. Grp1), include (Common + Grp1).
    // If currentItem is Common, include (Common).
    (currentItem.group ? (!s.group || s.group === currentItem.group) : !s.group)
  ).sort((a, b) => {
    // Sort by Date then by Start Period
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    if (dateA !== dateB) return dateA - dateB;
    return a.startPeriod - b.startPeriod;
  });

  // 2. Find index of current item
  const index = relevantItems.findIndex(s => s.id === currentItem.id);
  
  if (index === -1) {
    return { cumulative: 0, isFirst: false, isLast: false };
  }

  // 3. Calculate cumulative progress up to this item
  let cumulative = 0;
  for (let i = 0; i <= index; i++) {
    cumulative += relevantItems[i].periodCount;
  }

  // Determine First/Last based on logical accumulation logic
  // First: If the periods BEFORE this session was 0
  const previousCumulative = cumulative - relevantItems[index].periodCount;
  const isFirst = previousCumulative === 0;

  // Last: If this session reaches or exceeds the total periods (if provided) 
  // OR if it's strictly the last item in the array and we assume the schedule is complete.
  // Using >= totalPeriods is safer for display highlighting.
  const isLast = (totalPeriods > 0 && cumulative >= totalPeriods) || (index === relevantItems.length - 1 && totalPeriods > 0 && cumulative >= totalPeriods);

  return {
    cumulative,
    isFirst,
    isLast
  };
};

export const determineStatus = (dateStr: string, startPeriod: number, currentStatus: ScheduleStatus): ScheduleStatus => {
  // Respect manual overrides for OFF and MAKEUP
  if (currentStatus === ScheduleStatus.OFF || currentStatus === ScheduleStatus.MAKEUP) {
    return currentStatus;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const classDate = parseLocal(dateStr);
  classDate.setHours(0, 0, 0, 0);
  
  if (classDate < today) return ScheduleStatus.COMPLETED;
  if (classDate > today) return ScheduleStatus.PENDING;

  // If dates are equal
  return ScheduleStatus.ONGOING;
};

// NEW: Global unified check for subject completion
export const isSubjectFinished = (
  subject: Subject,
  classEntity: ClassEntity | undefined, // Changed from classId to ClassEntity to check session
  schedules: ScheduleItem[]
): boolean => {
    // Cultural 8 subjects are never considered "finished" for payment/stats purposes automatically
    if (subject.majorId === 'culture_8') return false;

    // Fallback if classEntity is missing (should verify at call site)
    const classId = classEntity?.id || 'unknown';
    const uniqueKey = `${subject.id}-${classId}`;
    
    // 1. Metadata (Teaching Progress Override)
    try {
        const metaJson = localStorage.getItem('subject_progress_metadata');
        if (metaJson) {
            const meta = JSON.parse(metaJson);
            const data = meta[uniqueKey];
            if (data?.statusOverride === 'completed') return true;
            if (data?.statusOverride === 'in-progress') return false; 
        }
    } catch (e) { console.error(e) }

    // 2. Legacy Manual & Paid Checks (Optional fallback)
    try {
        const paid = JSON.parse(localStorage.getItem('paid_completed_subjects') || '[]');
        if (paid.includes(uniqueKey)) return true;
        const manual = JSON.parse(localStorage.getItem('manual_completed_subjects') || '[]');
        if (manual.includes(uniqueKey)) return true;
    } catch (e) { console.error(e) }

    // 3. Auto Calculation (Based on Period Count)
    const effectiveTotal = getEffectiveTotalPeriods(subject, classEntity);

    const learned = schedules
        .filter(s => s.subjectId === subject.id && s.classId === classId && s.status !== ScheduleStatus.OFF)
        .reduce((acc, curr) => acc + curr.periodCount, 0);
        
    // Must have started (learned > 0) AND reached total
    return learned >= effectiveTotal && learned > 0;
};
