package kz.astanaguide.scanner

import android.content.Context
import android.graphics.Bitmap
import dev.ffmpegkit.tesseract.TesseractOCR
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Keeps screen OCR local. Only the filtered road-hint text is sent to the caller;
 * screen images themselves are never stored or uploaded.
 */
class RussianScreenOcr(context: Context) {
    private val appContext = context.applicationContext
    private val engine = TesseractOCR()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Volatile
    private var initialized = false

    @Volatile
    private var initializationStarted = false

    fun initialize(onReady: ((Boolean, String?) -> Unit)? = null) {
        if (initializationStarted) return
        initializationStarted = true
        scope.launch {
            try {
                engine.initialize(appContext, language = "eng+rus")
                initialized = true
                withContext(Dispatchers.Main) { onReady?.invoke(true, null) }
            } catch (error: Throwable) {
                initialized = false
                val message = (error.message ?: "Не удалось загрузить русскую модель OCR").take(180)
                withContext(Dispatchers.Main) { onReady?.invoke(false, message) }
            }
        }
    }

    fun recognize(bitmap: Bitmap, onComplete: (String?, String?) -> Unit) {
        scope.launch {
            if (!initialized) {
                withContext(Dispatchers.Main) { onComplete(null, null) }
                return@launch
            }
            try {
                val result = engine.recognize(bitmap)
                withContext(Dispatchers.Main) { onComplete(result.text, null) }
            } catch (error: Throwable) {
                val message = (error.message ?: "Ошибка распознавания").take(180)
                withContext(Dispatchers.Main) { onComplete(null, message) }
            }
        }
    }

    fun isReady(): Boolean = initialized

    fun release() {
        initialized = false
        scope.cancel()
        engine.release()
    }
}
