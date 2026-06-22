// Injected via page.addInitScript() before app scripts run.
// Sets window.__DailyIframeMock so ProfessionalVideoCall.jsx uses it
// instead of the real @daily-co/daily-js SDK.
//
// Emits 'loading' and 'joined-meeting' automatically on join().
// Exposes window.__mockDailyFrame so tests can trigger 'left-meeting'.

window.__DailyIframeMock = (() => {
  let listeners = {}
  const frame = {
    on(event, cb) { listeners[event] = cb; return frame },
    join() {
      setTimeout(() => listeners['loading']?.(), 20)
      setTimeout(() => listeners['joined-meeting']?.({ participants: {} }), 80)
      return Promise.resolve()
    },
    destroy() { listeners = {} },
    leave() { listeners['left-meeting']?.(); return Promise.resolve() },
  }
  window.__mockDailyFrame = frame
  return { createFrame: () => frame }
})()
