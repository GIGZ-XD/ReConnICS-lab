<#
.SYNOPSIS
  One command: bring up the virtual plant in WSL2, run the scripted storyline, write the pcaps, serve the live state feed.
.DESCRIPTION
  Live  (default): WSL2 plant (network namespaces) for -Duration seconds; feed ws://localhost:8765/state while it runs;
                   pcaps + plant.truth.json in captures\plant; the run is also recorded to captures\plant\run.jsonl.gz.
  -Replay        : no WSL. Serves the committed recording plant\demo-run.jsonl.gz on the same feed (loops) using Windows Python.
.EXAMPLE
  .\plant\demo.ps1                 # live, 90 s
  .\plant\demo.ps1 -Replay         # viewer demo without WSL
#>
param(
  [int]$Duration = 90,
  [string]$Distro = $(if ($env:PLANT_DISTRO) { $env:PLANT_DISTRO } else { "kali-linux" }),
  [int]$Port = 8765,
  [switch]$Replay
)
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path "$PSScriptRoot\..").Path

if ($Replay) {
  Write-Host "Replaying plant\demo-run.jsonl.gz on ws://localhost:$Port/state (loops; Ctrl+C to stop)"
  & python "$Repo\plant\feed.py" --replay "$Repo\plant\demo-run.jsonl.gz" --loop --port $Port
  exit $LASTEXITCODE
}

if (-not ((wsl -l -q) -replace "`0", "" | Where-Object { $_.Trim() -eq $Distro })) {
  throw "WSL distro '$Distro' not found (wsl -l -v). Pass -Distro NAME or set `$env:PLANT_DISTRO. Needs root, tcpdump, iproute2, python3-venv; first run builds /root/labvenv."
}
Write-Host "Plant starting in WSL ($Distro), $Duration s. Storyline: boot + gratuitous ARP -> HMI polling -> EWS sweep -> L33ER firmware 20.011 -> 24.011 -> EWS sweep."
Write-Host "State feed (live while the plant runs, ~8 s after start): ws://localhost:$Port/state   latest frame: http://localhost:$Port/"
wsl -d $Distro -u root --cd $Repo -- sh plant/run.sh --duration $Duration --feed $Port --record captures/plant/run.jsonl.gz
if ($LASTEXITCODE -ne 0) { throw "plant run failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "Done. Written to $Repo\captures\plant :"
Get-ChildItem "$Repo\captures\plant" | ForEach-Object { "  {0,-24} {1,9:N0} bytes" -f $_.Name, $_.Length }
Write-Host @"

Next steps (full script: plant\DEMO.md)
  1. Viewer:  the live feed has ended; keep the viewer fed with  .\plant\demo.ps1 -Replay
              (or point it at ws://localhost:$Port/state)
  2. ReConnICS-ng site console (from the ng repo, branch fix/p0-ui-data or later):
       java -jar target\reconnics-ng.jar serve --index data\index.json --pubkey keys\index-signing.pub --data data\site-demo
       open http://127.0.0.1:8088/  -> upload  captures\plant\cell2-before.pcap , then  captures\plant\cell2-after.pcap
  3. Expected: 10.10.2.10 Rockwell 1769-L33ER, serial 60E1F4A2, firmware 20.011 then 24.011 in the change log,
     advisory ICSA-16-061-02 (EXACT).
"@
