#!/usr/bin/env python3
import subprocess, time, sys, os
from datetime import datetime

def adb(cmd):
    r = subprocess.run(f"adb shell {cmd}", shell=True, capture_output=True, text=True)
    return r.stdout.strip()

def get_cpu_usage():
    out = adb("top -n 1 -o %CPU -o COMMAND | head -15")
    procs = []
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2:
            procs.append({"cpu": float(parts[0].rstrip('%')), "cmd": parts[1] if len(parts) > 1 else "?"})
    return procs

def get_memory():
    out = adb("cat /proc/meminfo | head -3")
    try:
        total = int(out.split("\n")[0].split()[1]) // 1024
        free = int(out.split("\n")[1].split()[1]) // 1024
        used = total - free
        return {"total": total, "used": used, "pct": int((used/total)*100) if total else 0}
    except:
        return {"total": 0, "used": 0, "pct": 0}

def get_thermal():
    out = adb("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0")
    return int(out)//1000 if out.isdigit() else 0

def main():
    while True:
        os.system("clear" if os.name != "nt" else "cls")
        ts = datetime.now().strftime("%H:%M:%S")
        mem = get_memory()
        temp = get_thermal()
        procs = get_cpu_usage()
        
        print(f"\n📊 Monitor [{ts}] | Temp: {temp}°C | RAM: {mem['pct']}%")
        print("─" * 60)
        for p in procs[:10]:
            print(f"  {p['cpu']:>6.1f}% {p['cmd'][:50]}")
        print("\nPress Ctrl+C to stop")
        time.sleep(2)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
