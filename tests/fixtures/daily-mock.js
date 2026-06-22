// Injected via page.addInitScript() before app scripts run.
// Sets window.__DailyIframeMock so ProfessionalVideoCall.jsx uses it
// instead of the real @daily-co/daily-js SDK.
//
// Uses 300/500ms delays so React Strict Mode's unmount/remount cycle
// completes before events fire (the cycle is synchronous, so even 20ms
// would work, but 300ms removes all timing ambiguity).
//
// window.__mockFrameCreated is set to true when createFrame() is called,
// confirming the component actually rendered and called the Daily SDK.

window.__DailyIframeMock = (() => {
  let listeners = {}
  const frame = {
    on(event, cb) { listeners[event] = cb; return frame },
    join() {
      setTimeout(() => listeners['loading']?.(), 300)
      setTimeout(() => listeners['joined-meeting']?.({ participants: {} }), 500)
      return Promise.resolve()
    },
    destroy() { listeners = {} },
    leave() { listeners['left-meeting']?.(); return Promise.resolve() },
  }
  window.__mockDailyFrame = frame
  return {
    createFrame: (_container, _opts) => {
      window.__mockFrameCreated = true
      return frame
    },
  }
})()
