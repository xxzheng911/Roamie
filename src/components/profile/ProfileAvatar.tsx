import { useLayoutEffect, useRef } from "react";
import defaultAvatar from "@/assets/roamie-default-avatar.png";
import { useAvatar } from "@/hooks/use-avatar";
import { useUserMediaStore } from "@/hooks/use-user-media-store";
import {
  avatarRevisionFromUpdatedAt,
  resolveAvatarDisplayUrl,
} from "@/lib/profile-persisted-cache";
import { logUserMedia } from "@/lib/user-media/user-media-log";
import { cn } from "@/lib/utils";

type CommonProps = {
  className?: string;
  imgClassName?: string;
  alt?: string;
  priority?: boolean;
};

type SelfProps = CommonProps & {
  self: true;
};

type ExternalProps = CommonProps & {
  self?: false;
  avatarUrl?: string | null;
  displayName?: string | null;
  avatarUpdatedAt?: string | null;
  initial?: string;
  pending?: boolean;
  showDefault?: boolean;
  displaySrc?: string | null;
};

export type ProfileAvatarProps = SelfProps | ExternalProps;

function AvatarImageNode({
  src,
  alt,
  priority,
  className,
  imgClassName,
  /** Stable identity — prefer cache key so signed/?v= URL changes don't remount */
  stableKey,
}: {
  src: string;
  alt: string;
  priority: boolean;
  className?: string;
  imgClassName?: string;
  stableKey?: string;
}) {
  return (
    <img
      key={stableKey ?? "avatar"}
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      draggable={false}
      className={cn("h-full w-full object-cover", imgClassName, className)}
    />
  );
}

function NeutralAvatarPlaceholder({
  className,
  alt,
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <div
      className={cn("h-full w-full bg-secondary", className)}
      aria-busy="true"
      aria-hidden={!alt}
    />
  );
}

function ProfileAvatarSelf({ className, imgClassName, alt = "", priority = false }: SelfProps) {
  const { avatarDisplaySrc, avatarPending, showAvatarDefault } = useAvatar();
  const media = useUserMediaStore();
  const stableKey = media.avatarCacheKey ?? "self-avatar";
  const loggedFirstRender = useRef(false);

  useLayoutEffect(() => {
    if (loggedFirstRender.current) return;
    loggedFirstRender.current = true;
    const elapsedMs =
      media.hydratedAt != null ? Math.round(performance.now() - media.hydratedAt) : null;
    let source: "memory" | "disk" | "neutral" | "default" | "remote";
    if (media.avatarLocalUri && avatarDisplaySrc === media.avatarLocalUri) {
      source = "disk";
    } else if (avatarDisplaySrc && media.avatarUrl && avatarDisplaySrc === media.avatarUrl) {
      source = "remote";
    } else if (showAvatarDefault) {
      source = "default";
    } else {
      source = "neutral";
    }
    logUserMedia("HOME_AVATAR_FIRST_RENDER", {
      source,
      elapsedMs,
      avatarStatus: media.avatarStatus,
      hasCustomAvatar: media.hasCustomAvatar,
    });
    if (source === "default" && media.avatarStatus !== "none") {
      logUserMedia("HOME_AVATAR_DEFAULT_BLOCKED", {
        reason: "custom_avatar_status_unknown",
        avatarStatus: media.avatarStatus,
      });
    } else if (!avatarDisplaySrc && media.avatarStatus === "unknown") {
      logUserMedia("HOME_AVATAR_DEFAULT_BLOCKED", {
        reason: "custom_avatar_status_unknown",
      });
    }
  }, [
    avatarDisplaySrc,
    media.avatarLocalUri,
    media.avatarStatus,
    media.avatarUrl,
    media.hasCustomAvatar,
    media.hydratedAt,
    showAvatarDefault,
  ]);

  if (avatarDisplaySrc) {
    return (
      <AvatarImageNode
        src={avatarDisplaySrc}
        alt={alt}
        priority={priority}
        className={className}
        imgClassName={imgClassName}
        stableKey={stableKey}
      />
    );
  }

  // unknown / custom without bytes → neutral placeholder (never default).
  if (
    avatarPending ||
    media.avatarStatus === "unknown" ||
    media.avatarStatus === "custom" ||
    (media.hasCustomAvatar !== false && !showAvatarDefault)
  ) {
    return <NeutralAvatarPlaceholder className={className} alt={alt} />;
  }

  if (showAvatarDefault) {
    return (
      <AvatarImageNode
        src={defaultAvatar}
        alt={alt}
        priority={priority}
        className={className}
        imgClassName={imgClassName}
        stableKey="default-avatar"
      />
    );
  }

  return <NeutralAvatarPlaceholder className={className} alt={alt} />;
}

function ProfileAvatarExternal({
  className,
  imgClassName,
  alt = "",
  priority = false,
  avatarUrl,
  avatarUpdatedAt,
  initial,
  pending = false,
  showDefault = false,
  displaySrc,
}: ExternalProps) {
  const resolved =
    displaySrc ?? resolveAvatarDisplayUrl(avatarUrl, avatarUpdatedAt);

  if (resolved) {
    return (
      <AvatarImageNode
        src={resolved}
        alt={alt}
        priority={priority}
        className={className}
        imgClassName={imgClassName}
        stableKey={`ext-${String(avatarRevisionFromUpdatedAt(avatarUpdatedAt))}`}
      />
    );
  }

  if (showDefault && !pending) {
    return (
      <AvatarImageNode
        src={defaultAvatar}
        alt={alt}
        priority={priority}
        className={className}
        imgClassName={imgClassName}
      />
    );
  }

  if (initial?.trim()) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-secondary text-sm font-medium text-muted-foreground",
          className,
        )}
        aria-hidden={!alt}
      >
        {initial.trim().slice(0, 1).toUpperCase()}
      </div>
    );
  }

  if (pending) {
    return <NeutralAvatarPlaceholder className={className} alt={alt} />;
  }

  // External without URL and without showDefault → neutral, not bundled default flash.
  return <NeutralAvatarPlaceholder className={className} alt={alt} />;
}

export function ProfileAvatar(props: ProfileAvatarProps) {
  if (props.self) {
    return <ProfileAvatarSelf {...props} />;
  }
  return <ProfileAvatarExternal {...props} />;
}
