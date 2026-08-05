"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useDemoView } from "@/app/demo/components/DemoViewContext";

export interface KChatbotWidgetProps {
  appSurface: "child" | "parent";
  /** 022: 좌측 하단 플로팅에서 상단 헤더 우측 영역으로 이동 - 이 화면 헤더가 기본
   *  높이보다 더 높거나(예: 진행률 바가 두 줄인 미션 화면) 헤더 우측에 이미 다른
   *  요소(연결상태 표시 등)가 있어 겹치는 경우, 그 아래로 내려 배치하기 위한
   *  세로 오프셋(px). 지정하지 않으면 기본 헤더 높이(약 56px)+safe-area 아래에 온다. */
  topOffsetPx?: number;
  /** 022: 이 위젯은 화면 뷰포트 기준 fixed로 떠 있어, 헤더 콘텐츠 자체가 뷰포트
   *  전체 폭을 쓰지 않고 중앙 정렬된 고정 폭 컬럼인 화면(예: MissionConversationLayout의
   *  maxWidth:560 - 태블릿/PC 폭에서 그 컬럼 바깥에 회색 여백이 생김)에서는 지정한다.
   *  지정하면 뷰포트가 이 값+24px보다 넓을 때 그 중앙 컬럼의 우측 끝에 맞춰 정렬되고,
   *  더 좁을 때(모바일)는 자동으로 기본 뷰포트 우측 정렬로 되돌아간다. */
  containerMaxWidthPx?: number;
}

type Category = "voc" | "feature" | "bug";

/** 056: 공식 FAQ 페이지 URL. 공개 링크라 NEXT_PUBLIC_ 접두어가 규약상 적합하다(비밀값 아님).
 *  값이 없으면 URL을 임의로 만들지 않고 모달의 이동 버튼을 비활성으로 렌더링한다. */
const RAW_FAQ_URL = (process.env.NEXT_PUBLIC_FAQ_URL ?? "").trim();
const FAQ_URL = /^https?:\/\//i.test(RAW_FAQ_URL) ? RAW_FAQ_URL : null;

/** 056: 플로팅 버튼 위치 저장 키. 021/043의 구 스키마({xPercent,yPercent})는 복원 clamp가
 *  0~100 스케일 값을 0~1로 뭉개 세로 위치를 유실시켰으므로, 스키마를 바꾸면서 키도 올린다. */
const POSITION_STORAGE_KEY = "k_faq_button_position_v1";
/** 드래그로 인정하는 최소 이동 거리(px). 이하는 탭으로 보고 모달을 연다. */
const DRAG_THRESHOLD_PX = 8;
/** 하단 메뉴/주요 조작 버튼 영역으로 예약해 버튼이 침범하지 못하게 하는 높이(px). */
const BOTTOM_RESERVED_PX = 90;
/** 버튼 자체 높이(px, py-2 + text-sm 기준). 하단 clamp 계산에 쓴다. */
const BUTTON_HEIGHT_PX = 40;

type ButtonPosition = { edge: "left" | "right"; yRatio: number };

export default function KChatbotWidget({ appSurface, topOffsetPx = 56, containerMaxWidthPx }: KChatbotWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState<Category>("voc");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [resultMessage, setResultMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  type AttachmentState = {
    client_id: string;
    file: File;
    previewUrl: string;
    status: "processing" | "uploading" | "uploaded" | "failed";
    server_id?: string;
    error_message?: string;
  };
  const [attachments, setAttachments] = useState<AttachmentState[]>([]);


  const pathname = usePathname();
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 모달을 열 때(또는 제출 성공 후 폼 리셋 시) 1회 생성해, 같은 제출 시도(연타/네트워크
  // 재시도) 동안은 같은 값을 재사용한다 - 서버가 이 값에 유니크 제약을 걸어 중복 저장을
  // DB 레벨에서 막는다(app/api/support/route.ts 참고).
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  // --- DRAGGABLE FLOATING BUTTON (056) ---
  const [position, setPosition] = useState<ButtonPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });

  const dragRef = useRef({
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    isPointerDown: false,
    isDragging: false,
    /** 드래그 종료 직후 브라우저가 발생시키는 native click을 1회 삼키기 위한 플래그.
     *  click이 끝내 오지 않는 경우(터치에서 pointercancel 등)에도 다음 pointerdown이
     *  반드시 false로 되돌리므로, 잔류해서 정상 탭을 삼키는 상태가 생기지 않는다. */
    suppressClick: false,
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(POSITION_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (
        parsed &&
        (parsed.edge === "left" || parsed.edge === "right") &&
        typeof parsed.yRatio === "number" &&
        Number.isFinite(parsed.yRatio)
      ) {
        setPosition({
          edge: parsed.edge,
          yRatio: Math.min(1, Math.max(0, parsed.yRatio)),
        });
      }
    } catch {
      // 손상된 값이면 조용히 기본 위치(우측 하단)를 쓴다.
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return; // 마우스는 좌클릭만

    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      isPointerDown: true,
      isDragging: false,
      suppressClick: false,
    };

    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current.isPointerDown) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    // 드래그 진입 조건은 아이·부모 화면 공통으로 이동거리 하나뿐이다. 화면별로
    // 롱프레스/스와이프 취소를 다르게 두면 "눌렀는데 아무 일도 안 일어나는" 상태가
    // 생기고, 정지 롱프레스가 드래그로 오인돼 모달이 안 열리는 버그로 이어졌다.
    if (!dragRef.current.isDragging && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD_PX) {
      dragRef.current.isDragging = true;
      setIsDragging(true);
    }

    if (dragRef.current.isDragging) {
      setDragPos({
        x: e.clientX - dragRef.current.offsetX,
        y: e.clientY - dragRef.current.offsetY,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current.isPointerDown) return;

    dragRef.current.isPointerDown = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (!dragRef.current.isDragging) return; // 탭 → 이어지는 click이 모달을 연다.

    dragRef.current.isDragging = false;
    dragRef.current.suppressClick = true;
    setIsDragging(false);

    const btnLeft = e.clientX - dragRef.current.offsetX;
    const btnTop = e.clientY - dragRef.current.offsetY;
    const btnCenterX = btnLeft + e.currentTarget.offsetWidth / 2;

    const next: ButtonPosition = {
      edge: btnCenterX < window.innerWidth / 2 ? "left" : "right",
      // 세로는 3단계 스냅 없이 뷰포트 높이 대비 비율로 그대로 보존한다.
      // 헤더/하단메뉴/safe-area를 침범하지 않게 하는 것은 getButtonStyles()의 CSS clamp가 맡는다.
      yRatio: Math.min(1, Math.max(0, btnTop / window.innerHeight)),
    };
    setPosition(next);

    try {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 저장 실패(프라이빗 모드 등)해도 이번 세션 위치는 그대로 유지한다.
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (dragRef.current.suppressClick) {
      dragRef.current.suppressClick = false;
      e.preventDefault();
      return;
    }
    setIsOpen(true);
  };
  // ------------------------------

  // 022: DemoFrame(app/demo/components/DemoFrame.tsx)은 PC(포인터 fine + 폭 900px
  // 이상)에서 기기 목업을 그리며, 그 목업 안의 실제 페이지 콘텐츠에는
  // innerPaddingTop(태블릿 목업 pt-8=32px, 스마트폰 목업 pt-10=40px, 상단 상태바
  // 높이만큼)을 얹는다. 이 위젯의 버튼은 position:fixed라 그 padding의 영향을
  // 받지 않고 DemoFrame의 이너 디스플레이 영역(y=0) 기준으로 뜨는데, 각 페이지의
  // 실제 헤더는 그 padding 때문에 y=0이 아니라 y=32~40에서 시작한다 - PC 목업에서만
  // topOffsetPx가 실제 헤더보다 32~40px 높게(위로) 계산되어 헤더 아이콘과 겹치는
  // 버그가 있었다(Codex 리뷰 지적, Playwright bounding box로 재현 확인). DemoFrame과
  // 동일한 매체 쿼리로 PC 목업 여부를 판별해 그만큼 보정한다.
  const { view } = useDemoView();
  const [pcMockupPaddingTopPx, setPcMockupPaddingTopPx] = useState(0);
  useEffect(() => {
    const pcMq = window.matchMedia("(pointer: fine) and (min-width: 900px)");
    const update = () => setPcMockupPaddingTopPx(pcMq.matches ? (view === "mobile" ? 40 : 32) : 0);
    update();
    pcMq.addEventListener("change", update);
    return () => pcMq.removeEventListener("change", update);
  }, [view]);

  // Focus trap & Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === "Escape") {
      closeModal();
    } else if (e.key === "Tab") {
      if (!modalRef.current) return;
      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    }
  }, [isOpen]);

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", handleKeyDown);
      // Focus first element
      setTimeout(() => {
        const firstInput = modalRef.current?.querySelector<HTMLElement>('input, textarea, button');
        firstInput?.focus();
      }, 50);
    } else {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
      if (wasOpenRef.current) {
        triggerRef.current?.focus();
        wasOpenRef.current = false;
      }
    }
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const closeModal = () => {
    if (content.trim() !== "" || subject.trim() !== "" || attachments.length > 0) {
      if (!confirm(appSurface === "child" ? "작성하던 내용이 사라져. 정말 닫을까?" : "작성 중인 내용이 삭제됩니다. 정말 닫으시겠습니까?")) {
        return;
      }
    }
    setIsOpen(false);
    
    // Clean up orphans
    attachments.forEach(att => {
      if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      if (att.status === "uploaded" && att.server_id) {
        fetch(`/api/support/attachments?id=${att.server_id}`, { method: "DELETE" }).catch(() => {});
      }
    });
    
    resetForm();
  };

  const resetForm = () => {
    setCategory("voc");
    setSubject("");
    setContent("");
    setResultMessage(null);
    setAttachments([]);
    // 다음번 제출은 완전히 새 시도이므로 새 idempotency key를 발급한다(이번 제출과
    // 겹치지 않게). 실패 후 재시도(폼 유지, resetForm 미호출)는 기존 값을 그대로 써서
    // 서버가 같은 시도로 인식하도록 한다.
    idempotencyKeyRef.current = crypto.randomUUID();
  };


  // --- ATTACHMENT HELPERS ---
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    e.target.value = ""; // reset input

    if (attachments.length + files.length > 3) {
      alert("이미지는 최대 3장까지 첨부할 수 있어요.");
      return;
    }

    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        alert("이미지는 한 장당 10MB 이하만 첨부할 수 있어요.");
        continue;
      }
      
      const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
      if (!allowedTypes.includes(file.type)) {
        alert("지원하지 않는 파일 형식입니다.");
        continue;
      }

      const client_id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      
      const newAtt: AttachmentState = {
        client_id,
        file,
        previewUrl,
        status: "processing"
      };
      
      setAttachments(prev => [...prev, newAtt]);
      
      // Process and upload
      processAndUpload(newAtt);
    }
  };

  const processAndUpload = async (att: AttachmentState) => {
    try {
      // 1. Process image (resize, compress, strip EXIF)
      const processedFile = await processImage(att.file);
      
      setAttachments(prev => prev.map(a => a.client_id === att.client_id ? { ...a, status: "uploading" } : a));
      
      // 2. Upload
      const formData = new FormData();
      formData.append("file", processedFile);
      formData.append("upload_session_id", idempotencyKeyRef.current);
      formData.append("display_order", "0"); // Not strictly ordered in this simple implementation, or we can use index

      const res = await fetch("/api/support/attachments", {
        method: "POST",
        body: formData
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      
      setAttachments(prev => prev.map(a => a.client_id === att.client_id ? { ...a, status: "uploaded", server_id: data.attachment.id } : a));
      
    } catch (err) {
      console.error(err);
      setAttachments(prev => prev.map(a => a.client_id === att.client_id ? { ...a, status: "failed", error_message: "업로드 실패" } : a));
    }
  };

  const processImage = async (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > 2048 || height > 2048) {
          if (width > height) {
            height = Math.round(height * (2048 / width));
            width = 2048;
          } else {
            width = Math.round(width * (2048 / height));
            height = 2048;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(file);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (!blob) return resolve(file);
          resolve(new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), { type: "image/jpeg" }));
        }, "image/jpeg", 0.85);
      };
      img.onerror = () => reject(new Error("Image decode failed"));
      img.src = URL.createObjectURL(file);
    });
  };

  const handleDeleteAttachment = async (client_id: string) => {
    const att = attachments.find(a => a.client_id === client_id);
    if (!att) return;
    
    // Remove from state immediately for better UX
    setAttachments(prev => prev.filter(a => a.client_id !== client_id));
    URL.revokeObjectURL(att.previewUrl);
    
    if (att.status === "uploaded" && att.server_id) {
      try {
        await fetch(`/api/support/attachments?id=${att.server_id}`, { method: "DELETE" });
      } catch (err) {
        console.error("Failed to delete attachment from server", err);
      }
    }
  };
  
  const handleRetryAttachment = (client_id: string) => {
    const att = attachments.find(a => a.client_id === client_id);
    if (!att) return;
    setAttachments(prev => prev.map(a => a.client_id === client_id ? { ...a, status: "processing", error_message: undefined } : a));
    processAndUpload(att);
  };
  
  const isSubmitDisabled = isSubmitting || attachments.some(a => a.status === "processing" || a.status === "uploading" || a.status === "failed");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitDisabled) {
      if (attachments.some(a => a.status === "failed")) {
        alert("업로드 실패한 이미지가 있습니다. 삭제하거나 다시 시도해 주세요.");
      }
      return;
    }

    if (category !== "voc" && subject.trim().length < 2) {
      alert(appSurface === "child" ? "제목을 2글자 이상 적어줘!" : "제목을 2자 이상 입력해 주세요.");
      return;
    }
    if (content.trim().length < 2) {
      alert(appSurface === "child" ? "내용을 2글자 이상 적어줘!" : "내용을 2자 이상 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    setResultMessage(null);

    const deviceInfo = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      isMobile: /Mobi|Android/i.test(navigator.userAgent),
    };

    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          subject: category === "voc" ? "" : subject,
          content,
          current_route: pathname,
          app_surface: appSurface,
          app_version: process.env.NEXT_PUBLIC_APP_VERSION || "unknown",
          device_info: deviceInfo,
          idempotency_key: idempotencyKeyRef.current,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed");
      }

      setResultMessage({
        type: "success",
        text: appSurface === "child"
          ? `케이에게 잘 전달했어! 접수번호는 ${data.request_number}야.`
          : `정상적으로 접수되었습니다. 접수번호는 ${data.request_number}입니다.`,
      });
      setSubject("");
      setContent("");
      // 제출 성공한 첨부파일은 이미 feedback_request_id로 연결됐으므로, 이후 닫기
      // 버튼(closeModal)이 "미저장 콘텐츠"로 오인해 서버에서 삭제하지 않도록 목록만
      // 비운다(서버 DELETE 호출 없이 상태만 초기화 - resetForm과 달리 idempotency
      // key는 여기서 새로 발급하지 않는다. 성공 화면의 "확인" 버튼이 resetForm으로 처리).
      setAttachments([]);
    } catch (err) {
      console.error(err);
      setResultMessage({
        type: "error",
        text: appSurface === "child"
          ? "접수하지 못했어. 작성한 내용은 그대로 있으니 잠시 후 다시 시도해줘."
          : "접수하지 못했습니다. 작성한 내용은 유지되니 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getButtonStyles = (): React.CSSProperties => {
    const defaultRight = containerMaxWidthPx
      ? `max(0.75rem, calc(50% - ${containerMaxWidthPx / 2}px + 0.75rem))`
      : "0.75rem";
    const defaultLeft = containerMaxWidthPx
      ? `max(0.75rem, calc(50% - ${containerMaxWidthPx / 2}px + 0.75rem))`
      : "0.75rem";

    const baseStyle: React.CSSProperties = {
      background: "var(--color-k-navy)",
      touchAction: "none",
      transition: isDragging ? "none" : "top 0.3s, left 0.3s, right 0.3s, bottom 0.3s, transform 0.3s",
    };

    if (isDragging) {
      return {
        ...baseStyle,
        top: `${dragPos.y}px`,
        left: `${dragPos.x}px`,
        right: "auto",
        bottom: "auto",
        transform: "scale(1.05)",
        opacity: 0.9,
      };
    }

    if (!position) {
      return {
        ...baseStyle,
        top: "auto",
        right: defaultRight,
        left: "auto",
        bottom: `calc(90px + env(safe-area-inset-bottom))`,
        transform: "translateY(0)",
      };
    }

    const style = { ...baseStyle };

    if (position.edge === "left") {
      style.left = defaultLeft;
      style.right = "auto";
    } else {
      style.right = defaultRight;
      style.left = "auto";
    }

    // 저장된 세로 비율을 그대로 쓰되, 상단 헤더+safe-area와 하단 메뉴 영역을 침범하지
    // 못하게 CSS clamp로 가둔다. JS로 픽셀을 계산하지 않고 env()/dvh를 그대로 쓰기 때문에
    // 키보드가 올라오거나(dvh 축소) 화면이 회전해도 브라우저가 다시 안전 범위로 되돌린다.
    const minTop = `calc(${topOffsetPx + pcMockupPaddingTopPx}px + env(safe-area-inset-top))`;
    const maxTop = `calc(100dvh - ${BOTTOM_RESERVED_PX + BUTTON_HEIGHT_PX}px - env(safe-area-inset-bottom))`;
    // clamp()는 MIN > MAX인 극단적으로 낮은 뷰포트에서도 MIN을 채택하므로 별도 방어가 필요 없다.
    style.top = `clamp(${minTop}, ${(position.yRatio * 100).toFixed(2)}dvh, ${maxTop})`;
    style.bottom = "auto";
    style.transform = "translateY(0)";

    return style;
  };

  return (
    <>
      {/* 022: 좌측 하단 플로팅 → 상단 헤더 우측 영역으로 이동. 헤더 자체의 DOM 안에 넣지
          않고(13개 페이지마다 헤더 구조가 달라 공용 컴포넌트가 그 내부구조를 알 수 없음)
          fixed로 고정 배치해 모든 페이지에서 동일하게 동작하게 한다. topOffsetPx로 페이지별
          헤더 높이/기존 우측 요소(연결상태 표시 등)와의 겹침을 피한다.
          056: 라벨 "문의"→"FAQ". 세로 위치는 드래그로 자유롭게 옮길 수 있고 localStorage에 남는다. */}
      <button
        ref={triggerRef}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="fixed z-50 flex items-center gap-1.5 px-3 py-2 rounded-full shadow-md text-white transition-colors select-none focus:outline-none focus-visible:outline-3 focus-visible:outline-k-sky-blue focus-visible:outline-offset-2"
        style={getButtonStyles()}
        aria-label="FAQ 열기"
      >
        <span className="text-base leading-none">💬</span>
        <span className="font-bold text-sm whitespace-nowrap">FAQ</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="absolute inset-0" onClick={closeModal} />
          
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className="relative bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh] overflow-hidden"
          >
            <div className="flex justify-between items-center p-5 border-b">
              <div>
                <h2 id="modal-title" className="text-xl font-bold text-gray-900">
                  케이에게 알려주세요
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {appSurface === "child"
                    ? "궁금한 점이나 불편한 점, 케이에게 바라는 점을 알려줘!"
                    : "서비스 이용 중 문의사항, 건의사항 또는 오류를 남겨주세요."}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 p-2 text-xl leading-none"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              {resultMessage?.type === "success" ? (
                <div className="text-center py-8">
                  <div className="text-4xl mb-4">✅</div>
                  <p className="text-lg font-medium text-gray-800">{resultMessage.text}</p>
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      resetForm();
                    }}
                    className="mt-6 bg-k-navy text-white px-6 py-3 rounded-xl font-bold w-full"
                  >
                    확인
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  {/* 056: FAQ 안내 영역. 아래 3개 탭(문의/건의/버그)과 그 폼은 건드리지 않는다. */}
                  <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex flex-col items-center text-center gap-2 mb-2">
                    <h3 className="font-bold text-gray-900">FAQ</h3>
                    <p className="text-sm text-gray-600">사용법이 궁금하면 언제든지 확인해 보세요.</p>
                    {FAQ_URL ? (
                      <a
                        href={FAQ_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
                      >
                        FAQ 페이지로 이동
                      </a>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled
                          className="mt-1 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-700 shadow-sm opacity-50 cursor-not-allowed"
                        >
                          FAQ 페이지로 이동
                        </button>
                        <p className="text-xs text-gray-400">FAQ 페이지 준비 중입니다.</p>
                      </>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCategory("voc")}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-sm font-bold border transition-colors",
                        category === "voc" ? "bg-k-navy text-white border-k-navy" : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                      )}
                    >
                      문의하기
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategory("feature")}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-sm font-bold border transition-colors",
                        category === "feature" ? "bg-k-navy text-white border-k-navy" : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                      )}
                    >
                      건의하기
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategory("bug")}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-sm font-bold border transition-colors",
                        category === "bug" ? "bg-k-navy text-white border-k-navy" : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                      )}
                    >
                      버그 신고하기
                    </button>
                  </div>

                  {category !== "voc" && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-bold text-gray-700">
                        {category === "feature"
                          ? "어떤 기능을 원하나요?"
                          : category === "bug"
                          ? "어떤 문제가 발생했나요?"
                          : ""}
                      </label>
                      <input
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder={
                          category === "feature"
                            ? (appSurface === "child" ? "케이에게 바라는 것을 짧게 적어줘." : "어떤 기능을 원하나요?")
                            : (appSurface === "child" ? "어떤 문제가 생겼어?" : "어떤 문제가 발생했나요?")
                        }
                        className="border border-gray-300 rounded-xl p-3 w-full focus:ring-2 focus:ring-k-navy outline-none"
                        maxLength={100}
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5 flex-1 min-h-[150px]">
                    <label className="text-sm font-bold text-gray-700">
                      {category === "voc" ? "무엇이 궁금한가요?" : "내용"}
                    </label>
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder={
                        category === "voc"
                          ? (appSurface === "child" ? "케이에게 궁금한 내용을 적어줘." : "문의하실 내용을 입력해 주세요.")
                          : category === "feature"
                          ? (appSurface === "child" ? "왜 필요하고 어떻게 되면 좋을지 알려줘." : "어떻게 바뀌면 좋을지 자세히 알려주세요.")
                          : (appSurface === "child" ? "무엇을 누르거나 말했을 때 문제가 생겼는지 알려줘." : "무엇을 하던 중 문제가 발생했는지 적어주세요.")
                      }
                      className="border border-gray-300 rounded-xl p-3 w-full flex-1 resize-none focus:ring-2 focus:ring-k-navy outline-none"
                      maxLength={2000}
                    />
                  </div>

                  <div className="flex flex-col gap-2 mt-2">
                    <label className="text-sm font-bold text-gray-700">이미지 첨부 (선택)</label>
                    <p className="text-xs text-gray-500">
                      {appSurface === "child" 
                        ? "문제 화면이나 보여주고 싶은 사진이 있으면 올려줘. 이름이나 얼굴 같은 개인정보가 보이지 않는지 먼저 확인해 줘."
                        : "문제 화면이나 관련 이미지를 첨부할 수 있습니다. 개인정보가 포함되지 않았는지 확인해 주세요."}
                    </p>
                    
                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-3 mt-2">
                        {attachments.map((att, idx) => (
                          <div key={att.client_id} className="relative w-20 h-20 bg-gray-100 rounded-lg border border-gray-200 overflow-hidden flex-shrink-0 flex items-center justify-center group">
                            <img src={att.previewUrl} alt={`첨부 ${idx + 1}`} className="w-full h-full object-cover" />
                            
                            {(att.status === "processing" || att.status === "uploading") && (
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              </div>
                            )}
                            
                            {att.status === "failed" && (
                              <div className="absolute inset-0 bg-red-500/80 flex flex-col items-center justify-center">
                                <span className="text-white text-xs font-bold mb-1">실패</span>
                                <button type="button" onClick={() => handleRetryAttachment(att.client_id)} className="bg-white text-red-500 text-[10px] px-2 py-1 rounded shadow">재시도</button>
                              </div>
                            )}
                            
                            <button
                              type="button"
                              onClick={() => handleDeleteAttachment(att.client_id)}
                              className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label="삭제"
                            >
                              ✕
                            </button>
                            
                            <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 rounded">
                              {idx + 1}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {attachments.length < 3 && (
                      <div className="mt-1">
                        <label className="inline-flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold py-2.5 px-4 rounded-xl cursor-pointer transition-colors border border-gray-200">
                          {attachments.length > 0 ? "이미지 추가" : (appSurface === "child" ? "사진 선택" : "사진 선택")}
                          <input 
                            type="file" 
                            accept="image/jpeg,image/png,image/webp,image/heic,image/heif" 
                            multiple 
                            onChange={handleFileSelect} 
                            className="hidden" 
                          />
                        </label>
                      </div>
                    )}
                  </div>


                  {resultMessage?.type === "error" && (
                    <div className="text-red-500 text-sm font-medium p-2 bg-red-50 rounded-lg">
                      {resultMessage.text}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitDisabled}
                    className="bg-k-orange hover:opacity-90 text-white font-bold py-3.5 rounded-xl disabled:opacity-50 transition-colors mt-2"
                  >
                    {isSubmitting ? "제출 중..." : attachments.some(a => a.status === "processing" || a.status === "uploading") ? "이미지 처리 중..." : "제출하기"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
