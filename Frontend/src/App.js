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
  ZoomIn,
  ZoomOut,
  MonitorPlay,
  Settings,
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
    className="fixed bottom-4 right-4 p-4 rounded-xl shadow-2xl bg-gradient-to-r from-gray-900 to-gray-800 text-white z-50 flex items-center space-x-3"
  >
    {type === "error" ? (
      <div className="w-2 h-2 rounded-full bg-red-500" />
    ) : (
      <div className="w-2 h-2 rounded-full bg-green-500" />
    )}
    <span className="text-sm font-medium">{message}</span>
    <button
      onClick={onClose}
      className="ml-2 text-white/80 hover:text-white transition-colors"
    >
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl w-[400px] border border-gray-200 dark:border-gray-700"
      >
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-3 bg-blue-500/10 rounded-lg">
            <MonitorPlay className="w-6 h-6 text-blue-500" />
          </div>
          <h2 className="text-2xl font-semibold">Become Presenter</h2>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onLogin();
          }}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Presenter Password
              </label>
              <input
                type="password"
                placeholder="Enter your password"
                className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center space-x-2"
              >
                <Lock className="w-4 h-4" />
                <span>Login as Presenter</span>
              </button>
            </div>
          </div>
        </form>
      </motion.div>
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
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="border-b border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-6">
                <div className="flex items-center space-x-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                  <Users className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                    {activeUsers} viewing
                  </span>
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
                      className={`flex items-center px-6 py-2 bg-blue-500 text-white rounded-lg cursor-pointer hover:bg-blue-600 transition-colors ${
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
                    className="flex items-center px-6 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <Lock className="w-5 h-5 mr-2" />
                    Become Presenter
                  </button>
                )}
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() =>
                      setScale((scale) => Math.max(scale - 0.1, 0.5))
                    }
                    className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <ZoomOut className="w-5 h-5" />
                  </button>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                    {Math.round(scale * 100)}%
                  </span>
                  <button
                    onClick={() =>
                      setScale((scale) => Math.min(scale + 0.1, 2))
                    }
                    className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <ZoomIn className="w-5 h-5" />
                  </button>
                </div>

                {pdfUrl && (
                  <button
                    onClick={downloadPDF}
                    className="flex items-center px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Download
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* PDF Display */}
          <div className="p-8">
            {pdfUrl ? (
              <div className="flex flex-col items-center">
                <div className="relative overflow-auto max-h-[calc(100vh-300px)] scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
                  <canvas
                    ref={canvasRef}
                    className="mx-auto shadow-lg rounded-lg"
                  />
                </div>

                <div className="mt-6 flex items-center justify-center space-x-6">
                  <button
                    onClick={() => changePage(pageNumber - 1)}
                    disabled={pageNumber <= 1 || !isAdmin}
                    className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                    Page {pageNumber} of {numPages}
                  </span>
                  <button
                    onClick={() => changePage(pageNumber + 1)}
                    disabled={pageNumber >= numPages || !isAdmin}
                    className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <ChevronRight className="w-6 h-6" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[60vh]">
                <div className="p-6 bg-gray-50 dark:bg-gray-700/50 rounded-2xl mb-4">
                  <UserCircle className="w-16 h-16 text-gray-400 dark:text-gray-500" />
                </div>
                <p className="text-lg text-gray-500 dark:text-gray-400">
                  {isAdmin
                    ? "Upload a PDF to begin presenting"
                    : "Waiting for presenter to upload a PDF"}
                </p>
              </div>
            )}
          </div>
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

      <AnimatePresence>
        {showAdminLogin && (
          <AdminLoginModal
            onLogin={handleLogin}
            onClose={() => setShowAdminLogin(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default React.memo(PDFViewer);