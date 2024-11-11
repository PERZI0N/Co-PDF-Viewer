import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  ChevronLeft,
  ChevronRight,
  Upload,
  Loader2,
  UserCircle,
  Lock,
  Download,
} from "lucide-react";

//connecting to pdfjslib
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.worker.min.js";
const CONFIG = {
  WEBSOCKET_URL: "ws://localhost:8080/ws",
  UPLOAD_URL: "http://localhost:8080/upload",
  ADMIN_PASSWORD: "vaidik@VIT",
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  ALLOWED_FILE_TYPES: ["application/pdf"],
  RECONNECT_DELAY: 2000,
  MAX_RECONNECT_ATTEMPTS: 5,
};
const Toast = React.memo(({ message, type = "info", onClose }) => (
  <motion.div
    initial={{ opacity: 0, y: 50 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 20 }}
    className={`fixed bottom-4 right-4 p-4 rounded-lg shadow-lg ${
      type === "error" ? "bg-red-500" : "bg-gray-800"
    } text-white z-50`}
  >
    {message}
    <button onClick={onClose} className="ml-4 text-white/80 hover:text-white">
      ×
    </button>
  </motion.div>
));
// auth to match the passwords
const AdminLoginModal = React.memo(({ onLogin, onClose }) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (password === CONFIG.ADMIN_PASSWORD) {
      onLogin();
      setPassword("");
    } else {
      setError("Invalid password");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-96">
        <h2 className="text-xl font-bold mb-4">Become Prerenter</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter presenter password"
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          {error && <p className="text-red-500 mb-4">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Login
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

const PDFViewer = () => {
  // All the necessary usestates
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [activeUsers, setActiveUsers] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [scale, setScale] = useState(1);
  const [isConnected, setIsConnected] = useState(false);
  const [toast, setToast] = useState(null);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const pdfDocumentRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);
  //button to download the latest uploaded pdf
  const downloadPDF = useCallback(async () => {
    if (!pdfUrl) {
      showToast("No PDF available to download", "error");
      return;
    }

    try {
      const response = await fetch(pdfUrl);
      if (!response.ok) throw new Error("PDF download failed");
      const blob = await response.blob();
      const filename = pdfUrl.split("/").pop() || "downloaded.pdf";
      const link = document.createElement("a");
      link.href = window.URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("PDF downloaded successfully");
    } catch (error) {
      console.error("Download error:", error);
      showToast("Failed to download PDF", "error");
    }
  }, [pdfUrl, showToast]);

  const renderPage = useCallback(
    async (pdf, pageNum) => {
      if (!pdf || !canvasRef.current) return;

      try {
        const page = await pdf.getPage(pageNum);
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        const viewport = page.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;
      } catch (error) {
        console.error("Render error:", error);
        showToast("Failed to render page", "error");
      }
    },
    [scale, showToast]
  );

  const loadPdf = useCallback(
    async (url) => {
      try {
        setLoading(true);
        const pdf = await pdfjsLib.getDocument(url).promise;
        pdfDocumentRef.current = pdf;
        setNumPages(pdf.numPages);
        await renderPage(pdf, pageNumber);
        return pdf;
      } catch (error) {
        console.error("PDF loading error:", error);
        showToast("Failed to load PDF", "error");
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [renderPage, showToast, pageNumber]
  );

  const connectWebSocket = useCallback(() => {
    if (reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      showToast(
        "Unable to connect to server. Please refresh the page.",
        "error"
      );
      return;
    }
    if (wsRef.current) {
      wsRef.current.close();
    }

    const websocket = new WebSocket(CONFIG.WEBSOCKET_URL);

    websocket.onopen = () => {
      setIsConnected(true);
      setReconnectAttempts(0);
      // showToast("Connected to presentation server");
    };

    websocket.onclose = () => {
      setIsConnected(false);
      if (reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS) {
        // showToast("Connection lost. Reconnecting...", "error");
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          setReconnectAttempts((prev) => prev + 1);
          connectWebSocket();
        }, CONFIG.RECONNECT_DELAY);
      }
    };

    websocket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case "page_change":
            if (data.page !== pageNumber) {
              setPageNumber(data.page);
              if (pdfDocumentRef.current) {
                await renderPage(pdfDocumentRef.current, data.page);
              }
            }
            break;
          case "user_count":
            setActiveUsers((prev) => {
              if (prev !== data.count) return data.count;
              return prev;
            });
            break;
          case "admin_status":
            if (data.isAdmin !== isAdmin) {
              setIsAdmin(data.isAdmin);
              if (data.isAdmin) showToast("You are now the presenter");
            }
            break;
          case "new_pdf":
            if (data.filename) {
              const pdfPath = `http://localhost:8080/uploads/${data.filename}`;
              setPdfUrl(pdfPath);
              const newPdf = await loadPdf(pdfPath);
              if (data.currentPage && data.currentPage !== pageNumber) {
                setPageNumber(data.currentPage);
                await renderPage(newPdf, data.currentPage);
              }
              if (!isAdmin) showToast("New presentation loaded");
            }
            break;
        }
      } catch (err) {
        console.error("Message processing error:", err);
      }
    };

    wsRef.current = websocket;
  }, [reconnectAttempts, showToast, loadPdf, renderPage, pageNumber, isAdmin]);
  const handleFileUpload = useCallback(
    async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      if (!CONFIG.ALLOWED_FILE_TYPES.includes(file.type)) {
        showToast("Please upload a PDF file", "error");
        return;
      }
      if (file.size > CONFIG.MAX_FILE_SIZE) {
        showToast("File size exceeds limit", "error");
        return;
      }
      setLoading(true);
      const formData = new FormData();
      formData.append("pdf", file);
      try {
        const response = await fetch(CONFIG.UPLOAD_URL, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) throw new Error("Upload failed");
        const data = await response.json();
        const pdfPath = `http://localhost:8080/uploads/${data.filename}`;
        setPdfUrl(pdfPath);
        const newPdf = await loadPdf(pdfPath);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "new_pdf",
              filename: data.filename,
              currentPage: 1,
            })
          );
        }
      } catch (error) {
        console.error("Upload error:", error);
        showToast("Failed to upload PDF", "error");
      } finally {
        setLoading(false);
        event.target.value = "";
      }
    },
    [showToast, loadPdf]
  );

  const changePage = useCallback(
    (newPage) => {
      if (newPage >= 1 && newPage <= numPages && newPage !== pageNumber) {
        setPageNumber(newPage);
        if (pdfDocumentRef.current) {
          renderPage(pdfDocumentRef.current, newPage);
        }
        if (isAdmin && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "page_change",
              page: newPage,
            })
          );
        }
      }
    },
    [numPages, pageNumber, isAdmin, renderPage]
  );
// function to handle the login
  const handleLogin = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "auth",
          password: CONFIG.ADMIN_PASSWORD,
        })
      );
    }
    setShowAdminLogin(false);
  }, []);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connectWebSocket]);

  useEffect(() => {
    if (pdfUrl) {
      loadPdf(pdfUrl);
    }
  }, [pdfUrl, loadPdf]);
// the actual control to navigate around the pdf
  const pageControls = useMemo(
    () => (
      <div className="mt-4 flex items-center justify-center space-x-4">
        <button
          onClick={() => changePage(pageNumber - 1)}
          disabled={pageNumber <= 1 || !isAdmin}
          className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-gray-600 dark:text-gray-300">
          Page {pageNumber} of {numPages}
        </span>
        <button
          onClick={() => changePage(pageNumber + 1)}
          disabled={pageNumber >= numPages || !isAdmin}
          className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    ),
    [pageNumber, numPages, isAdmin, changePage]
  );

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center text-gray-600 dark:text-gray-300">
              <Users className="w-5 h-5 mr-2" />
              <span>{activeUsers} viewing</span>
            </div>
            {isAdmin ? (
              <div className="relative">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileUpload}
                  disabled={loading}
                  className="hidden"
                  id="pdf-upload"
                />
                <label
                  htmlFor="pdf-upload"
                  className={`flex items-center px-4 py-2 bg-blue-500 text-white rounded cursor-pointer hover:bg-blue-600 ${
                    loading ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  ) : (
                    <Upload className="w-5 h-5 mr-2" />
                  )}
                  {loading ? "Uploading..." : "Upload PDF"}
                </label>
              </div>
            ) : (
              <button
                onClick={() => setShowAdminLogin(true)}
                className="flex items-center px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              >
                <Lock className="w-5 h-5 mr-2" />
                Become Presenter
              </button>
            )}
          </div>
          {pdfUrl && (
            <button
              onClick={downloadPDF}
              className="flex items-center px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
            >
              <Download className="w-5 h-5 mr-2" />
              Download PDF
            </button>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4">
          {pdfUrl ? (
            <>
              <canvas ref={canvasRef} className="mx-auto max-w-full" />
              {pageControls}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-96">
              <UserCircle className="w-16 h-16 text-gray-400 dark:text-gray-600 mb-4" />
              <p className="text-gray-500 dark:text-gray-400">
                {isAdmin
                  ? "Upload a PDF to begin presenting"
                  : "Waiting for presenter to upload a PDF"}
              </p>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>

      {showAdminLogin && (
        <AdminLoginModal
          onLogin={handleLogin}
          onClose={() => setShowAdminLogin(false)}
        />
      )}
    </div>
  );
};

export default React.memo(PDFViewer);