import { useState } from "react";
import { Button } from "@proxyshard/shardx-ui-kit";
import { DownloadIcon } from "../../../shared/icons";
import { BatchImportModal } from "../../batch-import";

export function ImportProfilesButton() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <Button
        variant="neutral"
        mode="stroke"
        size="small"
        leftIcon={<DownloadIcon className="size-4" />}
        onClick={() => setModalOpen(true)}
        title="Batch import profiles from Excel (.xlsx, .xls) or CSV files"
      >
        Batch Import
      </Button>

      <BatchImportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
