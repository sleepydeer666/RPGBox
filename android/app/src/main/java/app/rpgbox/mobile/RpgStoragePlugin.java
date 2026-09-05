package app.rpgbox.mobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import android.net.Uri;

@CapacitorPlugin(name = "RpgStorage")
public class RpgStoragePlugin extends Plugin {
    @PluginMethod
    public void copyPortrait(PluginCall call) {
        String sourceUri = call.getString("sourceUri");
        String gameId = call.getString("gameId");
        String characterId = call.getString("characterId");
        String fileName = call.getString("fileName");
        if (sourceUri == null || gameId == null || characterId == null || fileName == null) {
            call.reject("缺少立绘迁移参数");
            return;
        }
        try {
            File source = sourceFile(sourceUri);
            if (source == null || !source.isFile()) {
                call.reject("找不到旧立绘文件");
                return;
            }
            File targetDirectory = new File(getContext().getFilesDir(), "rpgbox-v2/rpgs/"
                    + safePart(gameId) + "/portraits/" + safePart(characterId));
            if (!targetDirectory.mkdirs() && !targetDirectory.isDirectory()) {
                call.reject("无法创建立绘目录");
                return;
            }
            File target = new File(targetDirectory, safeFileName(fileName));
            Files.copy(source.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
            JSObject result = new JSObject();
            result.put("uri", Uri.fromFile(target).toString());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("迁移立绘失败", error);
        }
    }

    private File sourceFile(String uri) throws IOException {
        if (uri.startsWith("file://")) return new File(java.net.URI.create(uri));
        if (!uri.startsWith("/")) return null;
        return new File(uri);
    }

    private String safePart(String value) {
        return value.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    private String safeFileName(String value) {
        String name = new File(value).getName().replaceAll("[^a-zA-Z0-9._-]", "_");
        return name.isEmpty() ? "portrait.png" : name;
    }
}
