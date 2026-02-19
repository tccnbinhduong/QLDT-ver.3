
import React, { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { ScheduleStatus, ScheduleItem } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import *as XLSX from 'xlsx';
import { Download, AlertCircle, X, User, BookOpen, Layers } from 'lucide-react';
import { format } from 'date-fns';
import { parseLocal, isSubjectFinished, getEffectiveTotalPeriods } from '../utils';

const Statistics: React.FC = () => {
  const { teachers, schedules, subjects, classes } = useApp();
  const [showAlert, setShowAlert] = useState(true);
  const [selectedTeacher, setSelectedTeacher] = useState<any>(null); // State for modal

  // 1. Missed classes needing makeup
  // Logic: Filter out if Subject is Finished OR if there are corresponding Makeup sessions
  const missedClasses = useMemo(() => {
    const missedMap: Record<string, ScheduleItem[]> = {};
    const makeupMap: Record<string, number> = {};
    
    // Group items
    schedules.forEach(s => {
        const key = `${s.subjectId}-${s.classId}`;
        if (s.status === ScheduleStatus.OFF) {
            if (!missedMap[key]) missedMap[key] = [];
            missedMap[key].push(s);
        }
        if (s.status === ScheduleStatus.MAKEUP) {
            makeupMap[key] = (makeupMap[key] || 0) + 1;
        }
    });

    let results: ScheduleItem[] = [];

    Object.keys(missedMap).forEach(key => {
        const [subId, clsId] = key.split('-');
        
        const subject = subjects.find(s => s.id === subId);
        const cls = classes.find(c => c.id === clsId);
        if (!subject) return;

        // 1. If subject completed (use shared helper) -> No alert
        if (isSubjectFinished(subject, cls, schedules)) return;

        // 2. If has makeup sessions -> Reduce alerts
        // We assume makeup sessions cover the earliest missed classes first
        const makeupsCount = makeupMap[key] || 0;
        const missedItems = missedMap[key].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        // If we have enough makeups to cover all missed, show nothing.
        // Otherwise show the remaining earliest ones (or latest? usually earliest are the ones needing attention).
        if (makeupsCount >= missedItems.length) return;

        const remaining = missedItems.slice(makeupsCount);
        results = [...results, ...remaining];
    });

    return results;
  }, [schedules, subjects, classes]);

  // 2. Teacher Stats (Memoized)
  const teacherStats = useMemo(() => {
      return teachers.map(t => {
        // Base filter: Get all valid teaching schedules for this teacher
        // Exclude OFF sessions
        // Include 'class' type OR 'exam' type if it's 'thực hành'
        const allSchedules = schedules.filter(s => 
            s.teacherId === t.id && 
            s.status !== ScheduleStatus.OFF &&
            (s.type === 'class' || (s.type === 'exam' && s.note?.toLowerCase().includes('thực hành')))
        ); 

        // Helper: Calculate unique periods to handle Shared Subjects (Classes taught at the same time count as 1)
        const calculateUniquePeriods = (items: ScheduleItem[]) => {
            const uniqueSlots = new Set<string>();
            let total = 0;
            items.forEach(item => {
                // Key based on Date and Start Period. 
                // If a teacher teaches multiple classes at the same time (shared subject), 
                // they will have the same date and start period.
                const slotKey = `${item.date}-${item.startPeriod}`;
                if (!uniqueSlots.has(slotKey)) {
                    uniqueSlots.add(slotKey);
                    total += item.periodCount;
                }
            });
            return total;
        };

        // Filter for Active (Not finished)
        const activeItems = allSchedules.filter(s => {
            const sub = subjects.find(sub => sub.id === s.subjectId);
            const cls = classes.find(c => c.id === s.classId);
            // If subject exists and is NOT finished, count it towards active load
            return sub && !isSubjectFinished(sub, cls, schedules);
        });

        // Filter for Completed (Taught)
        const completedItems = allSchedules.filter(s => s.status === ScheduleStatus.COMPLETED);

        // Calculate Metrics using unique slot logic
        const activeLoad = calculateUniquePeriods(activeItems);
        const taughtLoad = calculateUniquePeriods(completedItems);

        // Extra Info for Export
        // 1. List of classes taught
        const uniqueClassIds = Array.from(new Set(allSchedules.map(s => s.classId)));
        const classNames = uniqueClassIds.map(id => classes.find(c => c.id === id)?.name).filter(Boolean).join(', ');

        // 2. Subject Breakdown (NEW)
        const uniqueSubjectIds = Array.from(new Set(allSchedules.map(s => s.subjectId)));
        const subjectDetailsArray = uniqueSubjectIds.map(subId => {
            const sub = subjects.find(s => s.id === subId);
            if (!sub) return null;
            
            // Get schedules for this specific subject taught by this teacher
            const subSchedules = allSchedules.filter(s => s.subjectId === subId);
            // Calculate periods using the unique slot logic (in case of shared classes within the same subject)
            const periods = calculateUniquePeriods(subSchedules);
            
            return `${sub.name} (${periods} tiết)`;
        }).filter(Boolean);
        
        const subjectDetails = subjectDetailsArray.join(', ');

        // 3. Start and End Dates (Keeping calculation for internal use if needed, but removed from export)
        let startDate = '';
        let endDate = '';
        if (allSchedules.length > 0) {
            const sortedDates = allSchedules.map(s => new Date(s.date).getTime()).sort((a, b) => a - b);
            startDate = format(new Date(sortedDates[0]), 'dd/MM/yyyy');
            endDate = format(new Date(sortedDates[sortedDates.length - 1]), 'dd/MM/yyyy');
        }

        return {
          name: t.name,
          activePeriods: activeLoad,
          taughtPeriods: taughtLoad,
          classList: classNames,
          subjectDetails: subjectDetails, // NEW field
          startDate,
          endDate
        };
      });
  }, [teachers, schedules, subjects, classes]);

  // Filter for Chart: Only show teachers currently teaching active subjects
  const chartData = teacherStats.filter(t => t.activePeriods > 0);

  // 3. Subject Progress (All active subjects across all classes)
  const subjectStats = useMemo(() => {
    const rawStats: any[] = [];
    
    // Step 1: Collect raw stats for every class-subject combination
    classes.forEach(cls => {
        const isH8 = cls.name.toUpperCase().includes('H8');
        
        // Subjects for this class
        const classSubjects = subjects.filter(s => {
            if (s.majorId === 'common') return true;
            if (s.majorId === 'culture') return !isH8;
            if (s.majorId === 'culture_8') return isH8;
            return s.majorId === cls.majorId;
        });
        
        classSubjects.forEach(sub => {
             // Fetch relevant schedules and sort to determine signature
             const relevantSchedules = schedules.filter(sch => 
                sch.subjectId === sub.id && 
                sch.classId === cls.id && 
                sch.status !== ScheduleStatus.OFF
            ).sort((a, b) => {
                const timeA = new Date(a.date).getTime();
                const timeB = new Date(b.date).getTime();
                return timeA - timeB || a.startPeriod - b.startPeriod;
            });
            
            const learned = relevantSchedules.reduce((acc, curr) => acc + curr.periodCount, 0);
            const effectiveTotal = getEffectiveTotalPeriods(sub, cls);
            const remaining = Math.max(0, effectiveTotal - learned);

            // Determine Schedule Signature (Date + StartPeriod + Teacher of the first session)
            // This distinguishes shared subjects taught at different times/teachers
            let signature = 'unscheduled';
            if (relevantSchedules.length > 0) {
                const first = relevantSchedules[0];
                signature = `${first.date}-${first.startPeriod}-${first.teacherId}`;
            }
            
            // Only show subjects that are "currently learning"
            // For culture_8, show even if remaining <= 0 (since they have no limit)
            const isCulture8 = sub.majorId === 'culture_8';
            
            if (learned > 0 && (remaining > 0 || isCulture8)) {
                 rawStats.push({
                     id: sub.id,
                     name: sub.name,
                     className: cls.name,
                     total: isCulture8 ? 0 : effectiveTotal, // 0 indicates no limit for Culture 8
                     learned: learned,
                     remaining: isCulture8 ? 0 : remaining, // No remaining bar for Culture 8
                     isShared: sub.isShared,
                     signature: signature // NEW: Add signature for grouping
                 });
            }
        });
    });

    // Step 2: Aggregate shared subjects
    const aggregatedResults: any[] = [];
    const sharedMap = new Map<string, any>(); // Key: subjectId-signature

    rawStats.forEach(item => {
        if (item.isShared) {
            // Group by Subject ID AND Schedule Signature
            // This ensures distinct batches (different time/teacher) are separated in the chart
            const key = `${item.id}-${item.signature}`;
            
            if (sharedMap.has(key)) {
                // Already exists, just append class name
                const existing = sharedMap.get(key);
                existing.classNames.push(item.className);
            } else {
                // New shared entry
                const newItem = {
                    ...item,
                    classNames: [item.className]
                };
                sharedMap.set(key, newItem);
                aggregatedResults.push(newItem);
            }
        } else {
            // Not shared, add directly
            aggregatedResults.push({
                ...item,
                classNames: [item.className]
            });
        }
    });

    // Step 3: Format final output
    return aggregatedResults.map(item => ({
        name: item.name,
        // Format: "Subject Name (Class A, Class B)"
        fullName: `${item.name} (${item.classNames.join(', ')})`,
        total: item.total,
        learned: item.learned,
        remaining: item.remaining
    }));
    
  }, [subjects, schedules, classes]);

  const exportTeacherReport = () => {
     // Prepare data for all teachers (even those with 0 active periods)
     const data = teacherStats.map(t => ({
         'Họ và tên': t.name,
         'Số tiết đang dạy (Chưa kết thúc)': t.activePeriods,
         'Số tiết đã dạy': t.taughtPeriods,
         'Các lớp giảng dạy': t.classList,
         'Các môn đã dạy kèm số tiết': t.subjectDetails // NEW Column
         // Removed StartDate/EndDate
     }));
    
    const ws = XLSX.utils.json_to_sheet(data);
    
    // Set column widths
    ws['!cols'] = [
        { wch: 25 }, // Name
        { wch: 30 }, // Active
        { wch: 20 }, // Taught
        { wch: 40 }, // Classes
        { wch: 60 }, // Subjects (Wider)
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ThongKeGiaoVien");
    XLSX.writeFile(wb, "Thong_Ke_Tiet_Day_Giao_Vien.xlsx");
  };

  // Dynamic height calculation
  const progressChartHeight = Math.max(300, subjectStats.length * 60);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Thống kê báo cáo</h1>

      {/* Quick Alert: Missed Classes */}
      {missedClasses.length > 0 && showAlert && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start space-x-3 relative">
          <AlertCircle className="text-red-500 mt-1 flex-shrink-0" />
          <div className="flex-1">
             <h3 className="font-bold text-red-700">Cần xếp lịch bù ({missedClasses.length} buổi)</h3>
             <ul className="text-sm text-red-600 mt-1 list-disc pl-4">
               {missedClasses.map(m => (
                 <li key={m.id}>
                    {m.date} - GV {teachers.find(t => t.id === m.teacherId)?.name} - Môn {subjects.find(s => s.id === m.subjectId)?.name} (Lớp {classes.find(c => c.id === m.classId)?.name})
                 </li>
               ))}
             </ul>
          </div>
          <button 
            onClick={() => setShowAlert(false)} 
            className="text-red-400 hover:text-red-600 p-1 hover:bg-red-100 rounded absolute top-2 right-2"
            title="Đóng thông báo"
          >
            <X size={20} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Teacher Chart */}
        <div className="bg-white p-6 rounded-xl shadow border h-[500px] flex flex-col">
           <div className="flex justify-between items-center mb-4 flex-shrink-0">
              <h3 className="font-bold text-gray-700">Số tiết đang dạy (Môn chưa kết thúc)</h3>
              <button onClick={exportTeacherReport} className="text-sm bg-green-100 text-green-700 px-3 py-1.5 rounded flex items-center hover:bg-green-200 transition-colors font-medium">
                <Download size={14} className="mr-1"/> Xuất Thống Kê Tổng
              </button>
           </div>
           <p className="text-xs text-gray-500 mb-2 italic">
               * Click vào cột để xem chi tiết thông tin giáo viên.<br/>
               * Môn học ghép (nhiều lớp học cùng lúc) chỉ được tính là 1 lần giảng dạy.
           </p>
           {chartData.length > 0 ? (
             <div className="flex-1 min-h-0">
               <ResponsiveContainer width="100%" height="100%">
                 <BarChart 
                    data={chartData}
                    onClick={(data) => {
                        if (data && data.activePayload && data.activePayload.length > 0) {
                            setSelectedTeacher(data.activePayload[0].payload);
                        }
                    }}
                    className="cursor-pointer"
                 >
                   <CartesianGrid strokeDasharray="3 3" vertical={false} />
                   <XAxis dataKey="name" tick={{fontSize: 11}} interval={0} angle={-15} textAnchor="end" height={60} />
                   <YAxis />
                   <Tooltip cursor={{fill: '#f3f4f6'}} />
                   <Bar dataKey="activePeriods" fill="#3B82F6" name="Số tiết đang dạy" barSize={40} />
                 </BarChart>
               </ResponsiveContainer>
             </div>
           ) : (
             <div className="flex-1 flex items-center justify-center text-gray-400 italic">
               Không có giáo viên nào đang dạy môn chưa kết thúc.
             </div>
           )}
        </div>

        {/* Progress Chart (Scrollable) */}
         <div className="bg-white p-6 rounded-xl shadow border h-[500px] flex flex-col">
           <h3 className="font-bold text-gray-700 mb-4 flex-shrink-0">Tiến độ (Tất cả các môn đang học)</h3>
           
           <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
               {subjectStats.length > 0 ? (
                  <div style={{ height: progressChartHeight }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={subjectStats} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" />
                            <YAxis dataKey="fullName" type="category" width={220} tick={{fontSize: 11}} />
                            <Tooltip cursor={{fill: '#f3f4f6'}} />
                            <Legend verticalAlign="top" height={36} />
                            <Bar dataKey="learned" stackId="a" fill="#10B981" name="Đã học" barSize={24} />
                            <Bar dataKey="remaining" stackId="a" fill="#E5E7EB" name="Chưa học" barSize={24} radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                  </div>
               ) : (
                   <div className="h-full flex items-center justify-center text-gray-400 italic px-6 text-center">
                       Không có môn nào đang diễn ra (Tất cả đã xong hoặc chưa bắt đầu).
                   </div>
               )}
           </div>
        </div>
      </div>

      {/* Teacher Detail Modal */}
      {selectedTeacher && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedTeacher(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
                    <h3 className="font-bold text-blue-800 text-lg flex items-center gap-2">
                        <User size={20} /> Thông tin Giáo viên
                    </h3>
                    <button onClick={() => setSelectedTeacher(null)} className="text-gray-400 hover:text-red-500">
                        <X size={24} />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <div className="text-center pb-4 border-b">
                         <div className="text-2xl font-bold text-gray-800">{selectedTeacher.name}</div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                            <div className="text-xs text-blue-600 uppercase font-bold">Số tiết đang dạy</div>
                            <div className="text-xl font-bold text-blue-800 mt-1">{selectedTeacher.activePeriods}</div>
                        </div>
                        <div className="bg-green-50 p-3 rounded-lg border border-green-100">
                            <div className="text-xs text-green-600 uppercase font-bold">Số tiết đã dạy</div>
                            <div className="text-xl font-bold text-green-800 mt-1">{selectedTeacher.taughtPeriods}</div>
                        </div>
                    </div>

                    <div>
                        <div className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
                            <Layers size={16} className="text-gray-500" /> Các lớp giảng dạy
                        </div>
                        <div className="bg-gray-50 p-3 rounded text-sm text-gray-700">
                            {selectedTeacher.classList || "Chưa có lớp nào"}
                        </div>
                    </div>

                    <div>
                        <div className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
                            <BookOpen size={16} className="text-gray-500" /> Chi tiết môn học
                        </div>
                        <div className="bg-gray-50 p-3 rounded text-sm text-gray-700 max-h-40 overflow-y-auto">
                            {selectedTeacher.subjectDetails ? (
                                <ul className="list-disc pl-4 space-y-1">
                                    {selectedTeacher.subjectDetails.split(', ').map((item: string, idx: number) => (
                                        <li key={idx}>{item}</li>
                                    ))}
                                </ul>
                            ) : "Chưa có dữ liệu"}
                        </div>
                    </div>
                </div>
                <div className="p-4 bg-gray-50 border-t flex justify-end">
                    <button 
                        onClick={() => setSelectedTeacher(null)}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                    >
                        Đóng
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Statistics;
