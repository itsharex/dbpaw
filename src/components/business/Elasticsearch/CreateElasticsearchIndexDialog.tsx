import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/services/api";
import { toast } from "sonner";
import {
  DEFAULT_ELASTICSEARCH_INDEX_BODY,
  parseElasticsearchIndexBody,
} from "./elasticsearch-index-management";

interface Props {
  open: boolean;
  connectionId: number | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (index: string) => Promise<void> | void;
}

export function CreateElasticsearchIndexDialog({
  open,
  connectionId,
  onOpenChange,
  onCreated,
}: Props) {
  const [indexName, setIndexName] = useState("");
  const [indexBody, setIndexBody] = useState(DEFAULT_ELASTICSEARCH_INDEX_BODY);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const reset = () => {
    setIndexName("");
    setIndexBody(DEFAULT_ELASTICSEARCH_INDEX_BODY);
    setValidationMsg(null);
    setIsCreating(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) reset();
  };

  const createIndex = async () => {
    if (connectionId === null) return;
    const index = indexName.trim();
    if (!index) {
      setValidationMsg("Index name is required.");
      return;
    }

    const parsed = parseElasticsearchIndexBody(indexBody);
    if (parsed.error) {
      setValidationMsg(parsed.error);
      return;
    }

    setIsCreating(true);
    setValidationMsg(null);
    try {
      await api.elasticsearch.createIndex({
        id: connectionId,
        index,
        body: parsed.body,
      });
      toast.success(`Index created · ${index}`);
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error("Failed to create Elasticsearch index", {
        description: e instanceof Error ? e.message : String(e),
      });
      return;
    } finally {
      setIsCreating(false);
    }

    try {
      await onCreated(index);
    } catch (e) {
      toast.error("Index created, but failed to refresh the index list", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Elasticsearch index</DialogTitle>
          <DialogDescription>
            Create an index with optional settings and mappings JSON.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="elasticsearch-index-name">Index name</Label>
            <Input
              id="elasticsearch-index-name"
              className="font-mono text-xs"
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              placeholder="products"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="elasticsearch-index-body">
              Settings / mappings JSON
            </Label>
            <Textarea
              id="elasticsearch-index-body"
              className="min-h-48 font-mono text-xs"
              value={indexBody}
              onChange={(e) => setIndexBody(e.target.value)}
            />
          </div>
          {validationMsg ? (
            <Alert variant="destructive">
              <AlertTitle>Invalid index definition</AlertTitle>
              <AlertDescription>{validationMsg}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void createIndex()}
              disabled={isCreating || !indexName.trim()}
            >
              {isCreating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Create index
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
