#!/bin/bash
DIR="$(dirname "$(readlink -f "$0")")"
PIDFILE="$DIR/.server.pid"
LOGFILE="$DIR/server.log"

start() {
  if [ -f "$PIDFILE" ] && kill -0 $(cat "$PIDFILE") 2>/dev/null; then
    echo "Already running (PID $(cat $PIDFILE))"
    return 1
  fi
  rm -f /tmp/kiro-screenshot-*.png
  cd "$DIR"
  nohup node server.js > "$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  echo "Started (PID $!) — http://localhost:3000"
}

stop() {
  if [ ! -f "$PIDFILE" ] || ! kill -0 $(cat "$PIDFILE") 2>/dev/null; then
    echo "Not running"
    rm -f "$PIDFILE"
    return 1
  fi
  pkill -P $(cat "$PIDFILE") 2>/dev/null
  kill $(cat "$PIDFILE") 2>/dev/null
  rm -f "$PIDFILE"
  rm -f /tmp/kiro-screenshot-*.png
  echo "Stopped"
}

status() {
  if [ -f "$PIDFILE" ] && kill -0 $(cat "$PIDFILE") 2>/dev/null; then
    echo "Running (PID $(cat $PIDFILE))"
  else
    echo "Not running"
    rm -f "$PIDFILE"
  fi
}

case "${1}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  *)       echo "Usage: $0 {start|stop|restart|status}" ;;
esac
