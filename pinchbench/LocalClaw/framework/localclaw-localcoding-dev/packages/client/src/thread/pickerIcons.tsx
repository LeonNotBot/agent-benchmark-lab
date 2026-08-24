// ProjectPicker / PickerBody 共用的图标
const cls = "h-4 w-4 shrink-0 text-text-400";

export const FolderIcon = () => (
  <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
  </svg>
);

export const PlusFolderIcon = () => (
  <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    <path d="M12 11v4M10 13h4" />
  </svg>
);

export const NoFolderIcon = () => (
  <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    <path d="M4 4l16 16" />
  </svg>
);

export const SearchIcon = () => (
  <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
  </svg>
);

export const CheckIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-text-200" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const PlusIcon = () => (
  <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-text-400" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const ChevronRightIcon = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-text-400" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

// 项目图标：圆角方框内一条竖点 + 横线（区别于文件夹，对齐设计稿的「项目」语义）
export const ProjectIcon = () => (
  <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
    <path d="M8 9h.01M11 9h5M8 13h.01M11 13h5" strokeLinecap="round" />
  </svg>
);

// 悬浮关闭：实心深色圆 + 白色 X（对齐 4.png 的关闭态）
export const CloseCircleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none">
    <circle cx="12" cy="12" r="10" fill="currentColor" />
    <path d="M9 9l6 6M15 9l-6 6" stroke="white" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
