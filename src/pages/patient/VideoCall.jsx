import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, PhoneOff, Video } from 'lucide-react'

export default function VideoCall({ profile }) {
  const navigate = useNavigate()
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="absolute inset-0 bg-black z-[110] flex flex-col animate-fade-in">
      {/* Doctor background */}
      <div className="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80"
          alt="Doctor"
          className="w-full h-full object-cover opacity-90"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/90" />
      </div>

      {/* Header bar */}
      <div className="relative z-10 pt-14 px-6 flex justify-between items-center">
        <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full flex items-center gap-2 border border-white/20">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className="text-white font-bold text-[13px]">{fmt(elapsed)}</span>
        </div>
        <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/20">
          <span className="text-white font-bold text-[13px]">Dr. Martín López</span>
        </div>
      </div>

      {/* Self view */}
      <div className="absolute top-32 right-6 w-28 h-40 bg-gray-800 rounded-2xl overflow-hidden border-2 border-white/30 shadow-2xl z-10">
        <img
          src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80"
          alt="Paciente"
          className="w-full h-full object-cover scale-x-[-1]"
        />
      </div>

      {/* Controls */}
      <div className="mt-auto relative z-10 pb-12 px-8 flex justify-center items-center gap-6">
        <button className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20">
          <Mic className="w-6 h-6 text-white" />
        </button>
        <button
          onClick={() => navigate('/paciente/dashboard')}
          className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform"
        >
          <PhoneOff className="w-7 h-7 text-white" />
        </button>
        <button className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20">
          <Video className="w-6 h-6 text-white" />
        </button>
      </div>
    </div>
  )
}
