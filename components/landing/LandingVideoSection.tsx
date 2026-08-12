"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LoaderCircle, Play, X } from "lucide-react";

type VideoPlayEvent = "landing_video_dad_play" | "landing_video_mom_play";

interface LandingVideo {
  id: string;
  title: string;
  description: string;
  playEvent: VideoPlayEvent;
}

interface YouTubePlayer {
  destroy: () => void;
  playVideo: () => void;
}

interface YouTubePlayerEvent {
  target: YouTubePlayer;
}

interface YouTubeStateChangeEvent extends YouTubePlayerEvent {
  data: number;
}

interface YouTubeErrorEvent extends YouTubePlayerEvent {
  data: number;
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      videoId: string;
      host: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: (event: YouTubePlayerEvent) => void;
        onStateChange: (event: YouTubeStateChangeEvent) => void;
        onError: (event: YouTubeErrorEvent) => void;
      };
    }
  ) => YouTubePlayer;
  PlayerState: {
    ENDED: number;
  };
}

type YouTubeWindow = Window &
  typeof globalThis & {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  };

const VIDEOS: readonly LandingVideo[] = [
  {
    id: "_c_McSeH9jw",
    title: "바쁜 아빠편",
    description: "아이와 이야기하고 싶은데 오늘도 시간이 부족했다면",
    playEvent: "landing_video_dad_play",
  },
  {
    id: "9yum0jzT93g",
    title: "바쁜 엄마편",
    description: '"오늘 어땠어?" 한마디도 늦어지는 날이 있다면',
    playEvent: "landing_video_mom_play",
  },
];

let youtubeApiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeIframeApi(): Promise<YouTubeApi> {
  const youtubeWindow = window as YouTubeWindow;
  if (youtubeWindow.YT?.Player) return Promise.resolve(youtubeWindow.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previousReadyHandler = youtubeWindow.onYouTubeIframeAPIReady;
    youtubeWindow.onYouTubeIframeAPIReady = () => {
      previousReadyHandler?.();
      if (youtubeWindow.YT?.Player) resolve(youtubeWindow.YT);
    };

    let script = document.getElementById("youtube-iframe-api") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "youtube-iframe-api";
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }

    script.addEventListener(
      "error",
      () => {
        youtubeApiPromise = null;
        reject(new Error("YouTube IFrame API를 불러오지 못했습니다."));
      },
      { once: true }
    );
  });

  return youtubeApiPromise;
}

function VideoThumbnail({ video }: { video: LandingVideo }) {
  return (
    // A native image is used so the max-resolution thumbnail can fall back without Next.js remote-host configuration.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://img.youtube.com/vi/${video.id}/maxresdefault.jpg`}
      alt={`${video.title} 소개 영상 미리보기`}
      loading="lazy"
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      onError={(event) => {
        const fallbackUrl = `https://img.youtube.com/vi/${video.id}/hqdefault.jpg`;
        if (event.currentTarget.src !== fallbackUrl) event.currentTarget.src = fallbackUrl;
      }}
    />
  );
}

function LandingVideoModal({
  video,
  signupCta,
  onClose,
  onComplete,
}: {
  video: LandingVideo;
  signupCta: ReactNode;
  onClose: () => void;
  onComplete: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const onCompleteRef = useRef(onComplete);
  const [playerStatus, setPlayerStatus] = useState<"loading" | "ready" | "error">("loading");

  onCloseRef.current = onClose;
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const previousStyles = {
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
        )
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      if (!firstElement || !lastElement) return;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previousStyles.overflow;
      body.style.paddingRight = previousStyles.paddingRight;
      body.style.position = previousStyles.position;
      body.style.top = previousStyles.top;
      body.style.width = previousStyles.width;
      window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let player: YouTubePlayer | null = null;
    let hasTrackedCompletion = false;

    setPlayerStatus("loading");
    void loadYouTubeIframeApi()
      .then((api) => {
        if (cancelled || !playerHostRef.current) return;
        const iframe = document.createElement("iframe");
        const playerUrl = new URL(`https://www.youtube-nocookie.com/embed/${video.id}`);

        iframe.className = "absolute inset-0 h-full w-full";
        iframe.title = `${video.title} 소개 영상`;
        iframe.allow = "autoplay; encrypted-media; picture-in-picture";
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        playerUrl.searchParams.set("autoplay", "1");
        playerUrl.searchParams.set("enablejsapi", "1");
        playerUrl.searchParams.set("playsinline", "1");
        playerUrl.searchParams.set("rel", "0");
        playerUrl.searchParams.set("origin", window.location.origin);
        iframe.src = playerUrl.toString();
        playerHostRef.current.replaceChildren(iframe);

        player = new api.Player(iframe, {
          width: "100%",
          height: "100%",
          videoId: video.id,
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            autoplay: 1,
            enablejsapi: 1,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              setPlayerStatus("ready");
              event.target.playVideo();
            },
            onStateChange: (event) => {
              if (event.data !== api.PlayerState.ENDED || hasTrackedCompletion) return;
              hasTrackedCompletion = true;
              onCompleteRef.current();
            },
            onError: () => setPlayerStatus("error"),
          },
        });
      })
      .catch(() => {
        if (!cancelled) setPlayerStatus("error");
      });

    return () => {
      cancelled = true;
      player?.destroy();
    };
  }, [video]);

  const keepFocusInside = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab" && event.target === event.currentTarget) {
      event.preventDefault();
      closeButtonRef.current?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/80 p-2.5 backdrop-blur-sm sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="landing-video-modal-title"
        aria-describedby="landing-video-modal-description"
        tabIndex={-1}
        onKeyDown={keepFocusInside}
        className="relative max-h-[calc(100dvh-1.25rem)] w-full max-w-[430px] overflow-y-auto rounded-3xl bg-white p-3 shadow-2xl sm:p-4"
      >
        <div className="mb-2 flex min-h-11 items-center justify-between gap-3 pl-2">
          <h2 id="landing-video-modal-title" className="min-w-0 truncate text-base font-extrabold text-[var(--color-k-navy)]">
            {video.title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="소개 영상 닫기"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 motion-reduce:transition-none"
          >
            <X aria-hidden="true" className="h-6 w-6" />
          </button>
        </div>

        <p id="landing-video-modal-description" className="sr-only">
          {video.description}
        </p>
        <div
          className="relative mx-auto max-w-full overflow-hidden rounded-2xl bg-slate-950"
          style={{ width: "min(100%, calc(min(68dvh, 640px) * 9 / 16))", aspectRatio: "9 / 16" }}
        >
          <div ref={playerHostRef} className="absolute inset-0" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white" aria-live="polite" aria-atomic="true">
            {playerStatus === "loading" && (
              <>
              <LoaderCircle aria-hidden="true" className="h-8 w-8 animate-spin motion-reduce:animate-none" />
              <span className="sr-only">영상을 불러오는 중입니다.</span>
              </>
            )}
            {playerStatus === "error" && (
              <p className="px-6 text-center text-sm font-bold leading-6 text-white">
                영상을 불러오지 못했습니다.<br />닫았다가 다시 시도해 주세요.
              </p>
            )}
          </div>
        </div>

        <div className="px-1 pb-1 pt-3 text-center sm:px-3">
          <p className="mb-3 text-sm font-extrabold text-[var(--color-k-navy)]">우리 아이도 케이와 시작해보기</p>
          {signupCta}
        </div>
      </div>
    </div>
  );
}

export default function LandingVideoSection({
  signupCta,
  onPlay,
  onComplete,
}: {
  signupCta: ReactNode;
  onPlay: (eventName: VideoPlayEvent) => void;
  onComplete: () => void;
}) {
  const [activeVideo, setActiveVideo] = useState<LandingVideo | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const closeModal = () => {
    setActiveVideo(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <>
      <section aria-labelledby="landing-video-section-title" className="overflow-hidden px-4 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
        <div className="mx-auto max-w-[760px]">
          <div className="mx-auto max-w-[680px] text-center">
            <h2 id="landing-video-section-title" className="text-[28px] font-extrabold leading-[1.28] tracking-[-0.03em] text-[var(--color-k-navy)] sm:text-[36px] lg:text-[42px]">
              1분으로 먼저 만나보세요
            </h2>
            <p className="mx-auto mt-4 max-w-[600px] text-[15px] leading-7 text-slate-600 sm:text-[17px]">
              바쁜 부모의 하루에서 내친구 케이가 어떻게 대화를 이어주는지 확인해보세요.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-6">
            {VIDEOS.map((video) => (
              <button
                key={video.id}
                type="button"
                aria-label={`${video.title}: 1분 영상 보기`}
                onClick={(event) => {
                  triggerRef.current = event.currentTarget;
                  onPlay(video.playEvent);
                  setActiveVideo(video);
                }}
                className="group min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-[0_12px_35px_rgba(15,23,42,0.08)] transition-[transform,box-shadow] hover:-translate-y-1 hover:shadow-[0_18px_44px_rgba(15,23,42,0.13)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:rounded-3xl"
              >
                <span className="relative block aspect-[9/16] w-full overflow-hidden bg-slate-200">
                  <VideoThumbnail video={video} />
                  <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-slate-950/35 via-transparent to-slate-950/10" />
                  <span aria-hidden="true" className="absolute left-1/2 top-1/2 inline-flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-[var(--color-k-orange)] shadow-xl sm:h-16 sm:w-16">
                    <Play className="ml-1 h-7 w-7 fill-current sm:h-8 sm:w-8" />
                  </span>
                </span>
                <span className="flex min-h-[172px] flex-col p-3 sm:min-h-[184px] sm:p-5">
                  <span className="block text-[17px] font-extrabold leading-6 text-[var(--color-k-navy)] sm:text-xl">{video.title}</span>
                  <span className="mt-2 block text-[13px] leading-5 text-slate-600 sm:text-[15px] sm:leading-6">{video.description}</span>
                  <span className="mt-auto flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--color-k-navy)] px-2 py-2 text-center text-xs font-extrabold text-white sm:text-sm">
                    ▶ 1분 영상 보기
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {activeVideo && (
        <LandingVideoModal video={activeVideo} signupCta={signupCta} onClose={closeModal} onComplete={onComplete} />
      )}
    </>
  );
}
