# EduSchedule Pro

## Overview
EduSchedule Pro is a Vietnamese-language personal education management application built with React and Vite. It provides tools for managing courses, schedules, exams, students, payments, and teaching progress.

## Project Architecture
- **Framework**: React 19 + Vite 6 (TypeScript)
- **Styling**: Tailwind CSS (via CDN)
- **Charts**: Recharts
- **Icons**: Lucide React
- **Date handling**: date-fns
- **File export**: ExcelJS, xlsx, docxtemplater, file-saver

## Project Structure
```
/
├── index.html          # Entry HTML
├── index.tsx           # React entry point
├── App.tsx             # Main application component
├── types.ts            # TypeScript type definitions
├── utils.ts            # Utility functions
├── store/
│   └── AppContext.tsx   # React context for state management
├── components/
│   ├── Dashboard.tsx
│   ├── DocumentManager.tsx
│   ├── HolidayManager.tsx
│   ├── Management.tsx
│   ├── Payment.tsx
│   ├── ScheduleManager.tsx
│   ├── Statistics.tsx
│   ├── StudentManager.tsx
│   ├── SystemManager.tsx
│   └── TeachingProgress.tsx
├── vite.config.ts      # Vite configuration (port 5000)
├── tsconfig.json       # TypeScript configuration
└── package.json        # Dependencies
```

## Development
- **Dev server**: `npm run dev` (port 5000)
- **Build**: `npm run build` (outputs to `dist/`)
- **Deployment**: Static site deployment from `dist/`

## Environment Variables
- `GEMINI_API_KEY` - Optional, used for AI features

## Recent Changes
- 2026-02-20: Initial Replit setup, configured Vite for port 5000 with allowedHosts
