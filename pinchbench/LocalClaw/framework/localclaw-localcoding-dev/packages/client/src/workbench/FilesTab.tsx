// Files 标签：复用现有 FileBrowserTab，套确定高度的外壳
import type { ClientEvent } from "@lenovo/agent-protocol";
import { FileBrowserTab } from "./files/FileBrowserTab";

interface Props {
  workDir: string;
  sendEvent?: (event: ClientEvent) => void;
}

export function FilesTab({ workDir, sendEvent }: Props) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <FileBrowserTab workDir={workDir} sendEvent={sendEvent} />
    </div>
  );
}
