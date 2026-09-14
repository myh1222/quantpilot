import { execFile } from "node:child_process";

export type DesktopNotification = {
  title: string;
  body: string;
};

export interface DesktopNotifier {
  send(notification: DesktopNotification): Promise<void>;
}

export class MacOsNotifier implements DesktopNotifier {
  async send(notification: DesktopNotification): Promise<void> {
    const script = `display notification ${appleScriptString(notification.body)}`
      + ` with title ${appleScriptString(notification.title)}`;
    await new Promise<void>((resolve, reject) => {
      execFile("osascript", ["-e", script], (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
