import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationBarProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  itemName?: string;
}

export default function PaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  itemName = "items",
}: PaginationBarProps) {
  if (totalItems === 0) return null;

  const start = Math.min((page - 1) * pageSize + 1, totalItems);
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div className="pagination-bar" role="navigation" aria-label="Pagination">
      <div className="pagination-info">
        Showing <strong>{start}–{end}</strong> of <strong>{totalItems}</strong> {itemName}
      </div>
      {totalPages > 1 && (
        <div className="pagination-controls">
          <button
            type="button"
            className="btn btn-secondary btn-pagination"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} /> Previous
          </button>

          <span className="pagination-page-indicator">
            Page <strong>{page}</strong> of <strong>{totalPages}</strong>
          </span>

          <button
            type="button"
            className="btn btn-secondary btn-pagination"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
