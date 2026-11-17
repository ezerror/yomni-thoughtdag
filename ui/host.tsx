import React, { useLayoutEffect, useRef, useState } from 'react';
import type { PluginHostWorkbenchProps } from '@yomni/contracts';
import { App, connect } from '../dist/host-app/app.js';
import css from './canvas.css';

export default function ThoughtDag({ api, snapshot, active = true }: PluginHostWorkbenchProps) {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    if (!root.current || !active) return;
    let disposed = false;
    const connection = connect(api, root.current, snapshot.theme?.mode ?? 'light', snapshot.locale);
    void connection.ready.then(() => { if (!disposed) setReady(true); }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; connection.cleanup(); };
  }, [api, active, snapshot.theme?.mode, snapshot.locale]);
  return <div ref={root} className="thoughtdag-host" data-theme={snapshot.theme?.mode ?? 'light'} lang={snapshot.locale}>
    <style>{css}</style>
    {failed ? <p role="alert">{snapshot.locale.startsWith('zh') ? '画布未能加载，请重新打开思维画布。' : 'The canvas could not load. Reopen ThoughtDAG to retry.'}</p> : active && ready && <App />}
  </div>;
}
