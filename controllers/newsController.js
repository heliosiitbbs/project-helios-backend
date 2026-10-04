import supabase from "../config/Supabase.js";
import { sendPushToAll } from "../utils/pushNotifications.js";

// Get all news posts
export const getNews = async (req, res) => {
  try {
    const { data: newsPosts, error } = await supabase
      .from("campus_news")
      .select("*")
      .eq("status", "published")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Error fetching news posts"
      });
    }

    // Fetch likes and comments for mapping
    const { data: allLikes } = await supabase.from("Post_Likes").select("post_id");
    const { data: allComments } = await supabase.from("Post_Comments").select("post_id");

    const likesMap = {};
    const commentsMap = {};

    (allLikes || []).forEach(item => {
      if (item.post_id) {
        const pid = item.post_id.toString();
        likesMap[pid] = (likesMap[pid] || 0) + 1;
      }
    });

    (allComments || []).forEach(item => {
      if (item.post_id) {
        const pid = item.post_id.toString();
        commentsMap[pid] = (commentsMap[pid] || 0) + 1;
      }
    });

    const newsWithCounts = (newsPosts || []).map(post => {
      const pid = post.id.toString();
      const likes = likesMap[pid] || 0;
      const comments = commentsMap[pid] || 0;
      const views = (likes * 5) + (comments * 3);
      return {
        ...post,
        likes,
        comments,
        views
      };
    });

    return res.status(200).json({
      success: true,
      news: newsWithCounts
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"
    });
  }
};

// Create a news post
export const createNews = async (req, res) => {
  const { title, category, subject, photos, writer_name, writer_role, writer_profile_photo, status } = req.body;

  if (!title || !category || !writer_name) {
    return res.status(400).json({
      success: false,
      message: "Title, category, and writer_name are required"
    });
  }

  try {
    const { data, error } = await supabase
      .from("campus_news")
      .insert([
        {
          title,
          category,
          subject,
          photos: photos || [],
          writer_name,
          writer_role: writer_role || "IIT News Team",
          writer_profile_photo,
          status: status || "draft"
        }
      ])
      .select()
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Error creating news post"
      });
    }

    if (data.status === "published") {
      sendPushToAll({
        type: "news",
        title: "Campus News",
        body: data.title,
        data: { screen: "CampusNews" }
      }).catch((err) => console.error("Failed to send news push", err));
    }

    return res.status(201).json({
      success: true,
      message: "News post created successfully",
      post: data
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"
    });
  }
};

// Get all news posts (for admin, including drafts and published)
export const getAdminNews = async (req, res) => {
  try {
    const { data: newsPosts, error } = await supabase
      .from("campus_news")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Error fetching admin news posts"
      });
    }

    // Fetch likes and comments for mapping
    const { data: allLikes } = await supabase.from("Post_Likes").select("post_id");
    const { data: allComments } = await supabase.from("Post_Comments").select("post_id");

    const likesMap = {};
    const commentsMap = {};

    (allLikes || []).forEach(item => {
      if (item.post_id) {
        const pid = item.post_id.toString();
        likesMap[pid] = (likesMap[pid] || 0) + 1;
      }
    });

    (allComments || []).forEach(item => {
      if (item.post_id) {
        const pid = item.post_id.toString();
        commentsMap[pid] = (commentsMap[pid] || 0) + 1;
      }
    });

    const newsWithCounts = (newsPosts || []).map(post => {
      const pid = post.id.toString();
      const likes = likesMap[pid] || 0;
      const comments = commentsMap[pid] || 0;
      const views = (likes * 5) + (comments * 3);
      return {
        ...post,
        likes,
        comments,
        views
      };
    });

    return res.status(200).json({
      success: true,
      news: newsWithCounts
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"
    });
  }
};

// Update a news post
export const updateNews = async (req, res) => {
  const { id } = req.params;
  const { title, category, subject, photos, writer_name, writer_role, writer_profile_photo, status } = req.body;

  try {
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (category !== undefined) updateData.category = category;
    if (subject !== undefined) updateData.subject = subject;
    if (photos !== undefined) updateData.photos = photos;
    if (writer_name !== undefined) updateData.writer_name = writer_name;
    if (writer_role !== undefined) updateData.writer_role = writer_role;
    if (writer_profile_photo !== undefined) updateData.writer_profile_photo = writer_profile_photo;
    if (status !== undefined) updateData.status = status;

    // Only broadcast when a post actually transitions into "published" here,
    // not on every edit to an already-published post.
    let wasPublished = false;
    if (status === "published") {
      const { data: existing } = await supabase
        .from("campus_news")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      wasPublished = existing?.status === "published";
    }

    const { data, error } = await supabase
      .from("campus_news")
      .update(updateData)
      .eq("id", id)
      .select();

    if (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Error updating news post"
      });
    }

    if (status === "published" && !wasPublished && data?.[0]) {
      sendPushToAll({
        type: "news",
        title: "Campus News",
        body: data[0].title,
        data: { screen: "CampusNews" }
      }).catch((err) => console.error("Failed to send news push", err));
    }

    return res.status(200).json({
      success: true,
      message: "News post updated successfully",
      post: data && data.length > 0 ? data[0] : null
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"
    });
  }
};

// Delete a news post
export const deleteNews = async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase
      .from("campus_news")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Error deleting news post"
      });
    }

    return res.status(200).json({
      success: true,
      message: "News post deleted successfully"
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"
    });
  }
};

