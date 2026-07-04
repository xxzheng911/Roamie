import defaultAvatar from "@/assets/roamie-default-avatar.png";
import { useAvatar } from "@/hooks/use-avatar";
import {
  avatarRevisionFromUpdatedAt,
  resolveAvatarDisplayUrl,
} from "@/lib/profile-persisted-cache";
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
  cacheKeySuffix,
}: {
  src: string;
  alt: string;
  priority: boolean;
  className?: string;
  imgClassName?: string;
  cacheKeySuffix?: string;
}) {
  return (
    <img
      key={cacheKeySuffix ? `${src}-${cacheKeySuffix}` : src}
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

function ProfileAvatarSelf({ className, imgClassName, alt = "", priority = false }: SelfProps) {
  const { avatarDisplaySrc, avatarPending, showAvatarDefault } = useAvatar();

  if (avatarDisplaySrc) {
    return (
      <AvatarImageNode
        src={avatarDisplaySrc}
        alt={alt}
        priority={priority}
        className={className}
        imgClassName={imgClassName}
      />
    );
  }

  if (showAvatarDefault && !avatarPending) {
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

  if (avatarPending) {
    return (
      <div
        className={cn("h-full w-full bg-secondary", className)}
        aria-busy="true"
        aria-hidden={!alt}
      />
    );
  }

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
        cacheKeySuffix={String(avatarRevisionFromUpdatedAt(avatarUpdatedAt))}
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
    return (
      <div
        className={cn("h-full w-full bg-secondary", className)}
        aria-busy="true"
        aria-hidden={!alt}
      />
    );
  }

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

export function ProfileAvatar(props: ProfileAvatarProps) {
  if (props.self) {
    return <ProfileAvatarSelf {...props} />;
  }
  return <ProfileAvatarExternal {...props} />;
}
