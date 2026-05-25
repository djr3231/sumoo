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

const DEFAULT_FOLDER_SENTINEL_ID = "__default__";
const DEFAULT_FOLDER_LABEL = "סומו - העלאות (ברירת מחדל)";

interface FolderItem {
  id: string;
  name: string;
}

export type FolderSelection =
  | { kind: "default" }
  | { kind: "drive"; id: string; name: string };

interface Props {
  value: FolderSelection;
  onChange: (v: FolderSelection) => void;
  disabled?: boolean;
}

const DEFAULT_ITEM: FolderItem = {
  id: DEFAULT_FOLDER_SENTINEL_ID,
  name: DEFAULT_FOLDER_LABEL,
};

export function DriveFolderPicker({ value, onChange, disabled }: Props) {
  const [searchResults, setSearchResults] = React.useState<FolderItem[]>([]);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const selectedItem: FolderItem =
    value.kind === "default" ? DEFAULT_ITEM : { id: value.id, name: value.name };

  const items: FolderItem[] = React.useMemo(() => {
    const real = searchResults.filter((f) => f.id !== DEFAULT_FOLDER_SENTINEL_ID);
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
          `/api/drive/folders?q=${encodeURIComponent(next)}`,
          { signal: controller.signal },
        );
        const json = await res.json();
        if (controller.signal.aborted) return;
        setSearchResults(json.folders ?? []);
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
      itemToStringLabel={(f: FolderItem) => f.name}
      onValueChange={(next: FolderItem | null) => {
        if (!next || next.id === DEFAULT_FOLDER_SENTINEL_ID) {
          onChange({ kind: "default" });
        } else {
          onChange({ kind: "drive", id: next.id, name: next.name });
        }
      }}
      onInputValueChange={handleInputChange}
    >
      <ComboboxInput placeholder="חפש תיקיית Drive..." disabled={disabled} />
      <ComboboxContent>
        <ComboboxEmpty>לא נמצאו תיקיות</ComboboxEmpty>
        <ComboboxList>
          {(folder: FolderItem) => (
            <ComboboxItem key={folder.id} value={folder}>
              {folder.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
