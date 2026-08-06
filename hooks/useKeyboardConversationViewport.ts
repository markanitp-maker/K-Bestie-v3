import { useState, useEffect } from "react";

export function useKeyboardConversationViewport() {
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const initialInnerHeight = window.innerHeight;
    
    const updateViewport = () => {
      if (window.visualViewport) {
        const height = window.visualViewport.height;
        setViewportHeight(height);
        
        // threshold 75% 
        setIsKeyboardOpen(height < initialInnerHeight * 0.75);
      } else {
        const height = window.innerHeight;
        setViewportHeight(height);
        setIsKeyboardOpen(height < initialInnerHeight * 0.75);
      }
    };

    updateViewport();

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateViewport);
      window.visualViewport.addEventListener("scroll", updateViewport);
    } else {
      window.addEventListener("resize", updateViewport);
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", updateViewport);
        window.visualViewport.removeEventListener("scroll", updateViewport);
      } else {
        window.removeEventListener("resize", updateViewport);
      }
    };
  }, []);

  return { viewportHeight, isKeyboardOpen };
}
