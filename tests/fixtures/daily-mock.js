// Injected via page.addInitScript() before app scripts run.
// Mocks window.__DailyIframeMock so ProfessionalVideoCall.jsx uses it
// instead of the real @daily-co/daily-js SDK.
//
// Simulates the createCallObject() API — no UI iframe, just events.
// The 300/500ms delays give React Strict Mode's unmount+remount cycle
// time to complete before events fire.

window.__DailyIframeMock = (() => {
  // Minimal MediaStreamTrack-like object for video/audio tiles
  const mockTrack = { kind: 'video', readyState: 'live', enabled: true }
  const mockAudioTrack = { kind: 'audio', readyState: 'live', enabled: true }

  function makeParticipant(local) {
    return {
      local,
      tracks: {
        video: { persistentTrack: local ? mockTrack : null, state: 'playable' },
        audio: { persistentTrack: local ? mockAudioTrack : null, state: 'playable' },
      },
    }
  }

  function makeCallObject() {
    let listeners = {}
    let localCamOn = true
    let localMicOn = true

    const call = {
      on(event, cb) { listeners[event] = cb; return call },
      join(_opts) {
        setTimeout(() => {
          listeners['joined-meeting']?.({
            participants: { local: makeParticipant(true) },
          })
        }, 500)
        return Promise.resolve()
      },
      participants() {
        return { local: makeParticipant(true) }
      },
      setLocalVideo(enabled) {
        localCamOn = enabled
        setTimeout(() => {
          listeners['participant-updated']?.({ participant: makeParticipant(true) })
        }, 50)
        return Promise.resolve()
      },
      setLocalAudio(enabled) {
        localMicOn = enabled
        setTimeout(() => {
          listeners['participant-updated']?.({ participant: makeParticipant(true) })
        }, 50)
        return Promise.resolve()
      },
      leave() {
        setTimeout(() => listeners['left-meeting']?.(), 50)
        return Promise.resolve()
      },
      destroy() { listeners = {} },
    }
    return call
  }

  return {
    createCallObject: () => {
      window.__mockCallObjectCreated = true
      return makeCallObject()
    },
    // Keep createFrame stub so any legacy test code doesn't throw
    createFrame: (_container, _opts) => {
      window.__mockFrameCreated = true
      const frame = {
        on(_e, _cb) { return frame },
        join() { return Promise.resolve() },
        leave() { return Promise.resolve() },
        destroy() {},
      }
      return frame
    },
  }
})()
