/**
 * Gigi Startup Manager
 *
 * Registers Gigi to launch at login and optionally prunes redundant
 * startup entries so the system only runs what's needed.
 *
 * Works on macOS (LaunchAgents), Linux (systemd user / XDG autostart),
 * and Windows (registry Run key).
 */

import { existsSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';

export type StartupEntry = {
  name: string;
  path: string;
  command?: string;
  isGigi: boolean;
  essential: boolean;
};

// Apps we consider essential and never remove
const ESSENTIAL_APPS = new Set([
  // macOS
  'loginwindow', 'Dock', 'SystemUIServer', 'Finder', 'AirPlayUIAgent',
  'Spotlight', 'UserNotificationCenter', 'WiFiAgent',
  // Linux
  'gnome-keyring-daemon', 'at-spi-dbus-bus', 'pulseaudio', 'pipewire',
  'dbus-daemon', 'NetworkManager',
  // Windows
  'SecurityHealth', 'WindowsDefender', 'ctfmon',
]);

const GIGI_PLIST_LABEL = 'ai.gigi.launcher';

// ─── macOS ──────────────────────────────────────────────────────────────────

function getAgentsDir(): string {
  return join(homedir(), 'Library', 'LaunchAgents');
}

function listMacOSStartup(): StartupEntry[] {
  const dir = getAgentsDir();
  if (!existsSync(dir)) return [];

  const entries: StartupEntry[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.plist')) continue;
    const name = file.replace('.plist', '');
    const isGigi = name === GIGI_PLIST_LABEL;
    const essential = isGigi || ESSENTIAL_APPS.has(name);
    entries.push({ name, path: join(dir, file), isGigi, essential });
  }
  return entries;
}

function installMacOS(executablePath: string): void {
  const dir = getAgentsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${GIGI_PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${executablePath}</string>
    <string>--background</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), '.gigi', 'logs', 'gigi.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), '.gigi', 'logs', 'gigi-error.log')}</string>
</dict>
</plist>`;

  const plistPath = join(dir, `${GIGI_PLIST_LABEL}.plist`);
  writeFileSync(plistPath, plist, 'utf-8');

  try {
    execSync(`launchctl load -w "${plistPath}"`, { timeout: 5000 });
  } catch {
    // launchctl may fail in some environments — plist is still written
  }
}

function removeMacOSNonEssential(): StartupEntry[] {
  const entries = listMacOSStartup();
  const removed: StartupEntry[] = [];

  for (const entry of entries) {
    if (entry.isGigi || entry.essential) continue;
    try {
      execSync(`launchctl unload -w "${entry.path}"`, { timeout: 3000 });
    } catch { /* best-effort */ }
    try {
      unlinkSync(entry.path);
      removed.push(entry);
    } catch { /* permission denied */ }
  }

  return removed;
}

// ─── Linux ──────────────────────────────────────────────────────────────────

function getAutostartDir(): string {
  return join(homedir(), '.config', 'autostart');
}

function listLinuxStartup(): StartupEntry[] {
  const dir = getAutostartDir();
  if (!existsSync(dir)) return [];

  const entries: StartupEntry[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.desktop')) continue;
    const name = file.replace('.desktop', '');
    const isGigi = name === 'gigi';
    const essential = isGigi || ESSENTIAL_APPS.has(name);
    entries.push({ name, path: join(dir, file), isGigi, essential });
  }
  return entries;
}

function installLinux(executablePath: string): void {
  const dir = getAutostartDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const desktop = `[Desktop Entry]
Type=Application
Name=Gigi
Exec=${executablePath} --background
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Comment=Gigi AI assistant
`;

  writeFileSync(join(dir, 'gigi.desktop'), desktop, 'utf-8');

  // Also install as systemd user service for reliability
  const systemdDir = join(homedir(), '.config', 'systemd', 'user');
  if (!existsSync(systemdDir)) mkdirSync(systemdDir, { recursive: true });

  const service = `[Unit]
Description=Gigi AI Assistant
After=graphical-session.target

[Service]
Type=simple
ExecStart=${executablePath} --background
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;

  writeFileSync(join(systemdDir, 'gigi.service'), service, 'utf-8');
  try {
    execSync('systemctl --user daemon-reload && systemctl --user enable gigi.service', { timeout: 5000 });
  } catch { /* systemd may not be available */ }
}

function removeLinuxNonEssential(): StartupEntry[] {
  const entries = listLinuxStartup();
  const removed: StartupEntry[] = [];

  for (const entry of entries) {
    if (entry.isGigi || entry.essential) continue;
    try {
      unlinkSync(entry.path);
      removed.push(entry);
    } catch { /* permission denied */ }
  }

  return removed;
}

// ─── Windows ────────────────────────────────────────────────────────────────

function installWindows(executablePath: string): void {
  try {
    execSync(
      `reg add "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Gigi" /t REG_SZ /d "${executablePath} --background" /f`,
      { timeout: 5000 }
    );
  } catch { /* registry write may fail without elevation */ }
}

function listWindowsStartup(): StartupEntry[] {
  const entries: StartupEntry[] = [];
  try {
    const result = execSync(
      'reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"',
      { timeout: 5000, encoding: 'utf-8' }
    );
    for (const line of result.split('\n')) {
      const match = line.match(/^\s+(\S+)\s+REG_\w+\s+(.+)$/);
      if (!match) continue;
      const name = match[1]!;
      const command = match[2]!.trim();
      const isGigi = name.toLowerCase() === 'gigi';
      entries.push({ name, path: '', command, isGigi, essential: isGigi || ESSENTIAL_APPS.has(name) });
    }
  } catch { /* registry query failed */ }
  return entries;
}

function removeWindowsNonEssential(): StartupEntry[] {
  const entries = listWindowsStartup();
  const removed: StartupEntry[] = [];

  for (const entry of entries) {
    if (entry.isGigi || entry.essential) continue;
    try {
      execSync(
        `reg delete "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${entry.name}" /f`,
        { timeout: 3000 }
      );
      removed.push(entry);
    } catch { /* best-effort */ }
  }

  return removed;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** List all startup entries for the current user. */
export function listStartupEntries(): StartupEntry[] {
  const os = platform();
  if (os === 'darwin') return listMacOSStartup();
  if (os === 'linux') return listLinuxStartup();
  if (os === 'win32') return listWindowsStartup();
  return [];
}

/** Register Gigi as a startup app. */
export function installGigiStartup(executablePath: string): void {
  const os = platform();
  if (os === 'darwin') installMacOS(executablePath);
  else if (os === 'linux') installLinux(executablePath);
  else if (os === 'win32') installWindows(executablePath);
}

/** Remove non-essential startup entries. Returns list of what was removed. */
export function pruneStartupEntries(): StartupEntry[] {
  const os = platform();
  if (os === 'darwin') return removeMacOSNonEssential();
  if (os === 'linux') return removeLinuxNonEssential();
  if (os === 'win32') return removeWindowsNonEssential();
  return [];
}

/** Is Gigi registered as a startup app? */
export function isGigiStartupInstalled(): boolean {
  return listStartupEntries().some(e => e.isGigi);
}
