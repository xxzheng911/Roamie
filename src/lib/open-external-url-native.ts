import { registerPlugin } from "@capacitor/core";

type OpenExternalUrlPlugin = {
  open(options: { url: string }): Promise<void>;
};

export const OpenExternalUrl = registerPlugin<OpenExternalUrlPlugin>("OpenExternalUrl");
