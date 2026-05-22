import { Drawer } from "vaul";
import { useEffect, useState, type ReactNode, type RefObject } from "react";

/** 收起 ~22% · 中間 ~50% · 全展開 ~85% */
export const MAP_SHEET_SNAPS: (number | string)[] = [0.22, 0.5, 0.85];

type Props = {
  children: ReactNode;
  /** 限制 drawer portal 在探索頁容器內，避免蓋住搜尋欄 */
  containerRef: RefObject<HTMLElement | null>;
};

export function MapExploreSheet({ children, containerRef }: Props) {
  const [snap, setSnap] = useState<number | string | null>(MAP_SHEET_SNAPS[0]);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setContainer(containerRef.current);
  }, [containerRef]);

  if (!container) return null;

  return (
    <Drawer.Root
      open
      modal={false}
      dismissible={false}
      snapPoints={MAP_SHEET_SNAPS}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      fadeFromIndex={1}
      container={container}
    >
      <Drawer.Portal container={container}>
        <Drawer.Content
          className="absolute inset-x-0 bottom-0 z-[25] flex max-h-[92%] flex-col rounded-t-[2rem] border-t border-border bg-background/98 shadow-lift backdrop-blur-xl outline-none"
          aria-describedby={undefined}
        >
          <div className="flex shrink-0 justify-center py-3">
            <Drawer.Handle
              aria-label="拖曳調整高度"
              className="!mx-auto !h-1 !w-11 !cursor-grab !rounded-full !bg-muted-foreground/40 active:!cursor-grabbing"
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
