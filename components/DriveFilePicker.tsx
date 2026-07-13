"use client";
import * as React from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxInput,
  ComboboxEmpty,
} from "./ui/combobox";

const DEFAULT_FILE_SENTINEL_ID = "__default__";
const DEFAULT_FILE_LABEL = "ברירת מחדל (תבנית מובנית)";

interface FileItem {
  id: string;
  name: string;
}

export type FileSelection =
  | { kind: "default" }
  | { kind: "drive"; id: string; name: string };

interface Props {
  value: FileSelection;
  onChange: (v: FileSelection) => void;
  disabled?: boolean;
}

const DEFAULT_ITEM: FileItem = {
  id: DEFAULT_FILE_SENTINEL_ID,
  name: DEFAULT_FILE_LABEL,
};

export function DriveFilePicker({ value, onChange, disabled }: Props) {
  const [searchResults, setSearchResults] = React.useState<FileItem[]>([]);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const selectedItem: FileItem =
    value.kind === "default" ? DEFAULT_ITEM : { id: value.id, name: value.name };

  const items: FileItem[] = React.useMemo(() => {
    const real = searchResults.filter((f) => f.id !== DEFAULT_FILE_SENTINEL_ID);
    const needSelected =
      value.kind === "drive" && !real.some((f) => f.id === value.id);
    const withSelected = needSelected
      ? [...real, { id: value.id, name: value.name }]
      : real;
    return [DEFAULT_ITEM, ...withSelected];
  }, [searchResults, value]);

  function handleInputChange(next: string, details: { reason?: string }) {
    if (details.reason === "item-press") return;
    if (next.trim() === "") {
      setSearchResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      try {
        const res = await fetch(
          `/api/drive/files?q=${encodeURIComponent(next)}`,
          { signal: controller.signal },
        );
        const json = await res.json();
        if (controller.signal.aborted) return;
        setSearchResults(json.files ?? []);
      } catch {
        // abort or network error — ignore
      }
    }, 300);
  }

  return (
    <Combobox
      items={items}
      value={selectedItem}
      filter={null}
      itemToStringLabel={(f: FileItem) => f.name}
      onValueChange={(next: FileItem | null) => {
        if (!next || next.id === DEFAULT_FILE_SENTINEL_ID) {
          onChange({ kind: "default" });
        } else {
          onChange({ kind: "drive", id: next.id, name: next.name });
        }
      }}
      onInputValueChange={handleInputChange}
    >
      <ComboboxInput placeholder="חפש קובץ ב-Drive..." disabled={disabled} />
      <ComboboxContent>
        <ComboboxEmpty>לא נמצאו קבצים</ComboboxEmpty>
        <ComboboxList>
          {(file: FileItem) => (
            <ComboboxItem key={file.id} value={file}>
              {file.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
