import { useState, useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import { Play, Pause, Send } from "lucide-react";

export default function Annotator({ shareToken }: { shareToken: string }) {
  const [session, setSession] = useState<any>(null);
  const [nextItem, setNextItem] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const regions = useRef<RegionsPlugin | null>(null);

  useEffect(() => {
    // 1. Initialize Session
    const initSession = async () => {
      try {
        let sessionToken = localStorage.getItem(`annotate_session_${shareToken}`) || "";
        
        const url = new URL(`/api/annotate/${shareToken}/session`, window.location.origin);
        if (sessionToken) url.searchParams.append("session_token", sessionToken);

        const res = await fetch(url.toString());
        if (!res.ok) throw new Error("Could not initialize session");
        const data = await res.json();
        
        localStorage.setItem(`annotate_session_${shareToken}`, data.session_token);
        setSession(data);
        
        // 2. Fetch first item
        fetchNextItem(data.session_token);
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    };

    initSession();
  }, [shareToken]);

  const fetchNextItem = async (sessionToken: string) => {
    setLoading(true);
    try {
      const url = new URL(`/api/annotate/${shareToken}/next`, window.location.origin);
      url.searchParams.append("session_token", sessionToken);
      
      const res = await fetch(url.toString());
      const data = await res.json();
      
      if (data.message) {
        setNextItem(null); // Queue exhausted
      } else {
        setNextItem(data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (nextItem && containerRef.current) {
      // Initialize Wavesurfer
      if (wavesurfer.current) {
        wavesurfer.current.destroy();
      }

      wavesurfer.current = WaveSurfer.create({
        container: containerRef.current,
        waveColor: "#6366f1",
        progressColor: "#4f46e5",
        cursorColor: "#fff",
        barWidth: 2,
        barRadius: 2,
        height: 120,
      });

      const wsRegions = wavesurfer.current.registerPlugin(RegionsPlugin.create());
      regions.current = wsRegions;

      wsRegions.enableDragSelection({
        color: "rgba(99, 102, 241, 0.4)",
      });

      wavesurfer.current.load(nextItem.media_url);

      wavesurfer.current.on("play", () => setIsPlaying(true));
      wavesurfer.current.on("pause", () => setIsPlaying(false));
    }
  }, [nextItem]);

  const togglePlay = () => {
    if (wavesurfer.current) {
      wavesurfer.current.playPause();
    }
  };

  const submitAnnotation = async () => {
    if (!session || !nextItem) return;
    
    // Construct answer based on regions created
    const createdRegions = regions.current?.getRegions() || [];
    const answer = {
      label: selectedLabel,
      regions: createdRegions.map(r => ({ start: r.start, end: r.end }))
    };

    try {
      const res = await fetch(`/api/annotate/${shareToken}/items/${nextItem.data_unit_id}/annotations?session_token=${session.session_token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer })
      });
      
      if (!res.ok) throw new Error("Failed to submit annotation");
      
      // Fetch next item
      fetchNextItem(session.session_token);
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) return <div className="container text-center">Loading...</div>;
  if (error) return <div className="container text-center">Error: {error}</div>;

  if (!nextItem) {
    return (
      <div className="container text-center animate-fade-in glass-panel">
        <h2>All Done!</h2>
        <p>There are no more items left for you to annotate. Thank you!</p>
      </div>
    );
  }

  return (
    <div className="container animate-fade-in" style={{ width: "100%", maxWidth: "1000px" }}>
      <div className="glass-panel" style={{ marginBottom: "20px" }}>
        <h2>Instructions</h2>
        <p>{session.instructions || "Listen to the audio and mark regions."}</p>
      </div>

      <div className="glass-panel" style={{ marginBottom: "20px" }}>
        <div ref={containerRef} style={{ width: "100%", marginBottom: "16px" }}></div>
        
        <div className="flex-row" style={{ justifyContent: "center" }}>
          <button className="btn btn-secondary" onClick={togglePlay}>
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
        </div>
      </div>

      <div className="glass-panel">
        <h3 style={{ marginBottom: "16px" }}>Submit Annotation</h3>
        <div className="flex-col" style={{ gap: "16px" }}>
          <div>
            <label className="form-label">Select Label</label>
            <select 
              className="form-select" 
              value={selectedLabel}
              onChange={(e) => setSelectedLabel(e.target.value)}
            >
              <option value="">-- Choose --</option>
              {session.label_schema.map((ls: any, idx: number) => (
                <option key={idx} value={ls.name}>{ls.name} ({ls.type})</option>
              ))}
            </select>
          </div>
          
          <button 
            className="btn btn-primary" 
            style={{ width: "100%" }}
            onClick={submitAnnotation}
            disabled={!selectedLabel}
          >
            <Send size={18} /> Submit & Next
          </button>
        </div>
      </div>
    </div>
  );
}
