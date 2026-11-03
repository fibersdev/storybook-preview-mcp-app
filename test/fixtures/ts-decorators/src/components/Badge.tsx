import { useContext } from "react";
import { ThemeName } from "~/theme";

export function Badge({ text }: { text: string }) {
  const theme = useContext(ThemeName);
  return (
    <span data-testid="badge">
      {__BRAND__}: {text} ({theme})
    </span>
  );
}
